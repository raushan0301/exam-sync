import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { NotificationEventType, NotificationRecipientType, ReportJobStatus, ReportType } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { NOTIFICATIONS_REDIS_CONNECTION, REPORTS_QUEUE_NAME } from '../../common/queue/queue.constants';
import { buildAttendanceReportTable } from './generators/attendance-report';
import { buildSeatingPlanReportTable } from './generators/seating-plan-report';
import { buildIncidentReportTable } from './generators/incident-report';
import { buildRoomUtilizationReportTable } from './generators/room-utilization-report';
import { writeReportFile } from './report-file-writer';

/**
 * The consumer half of `report_jobs` (see `ReportsService`'s own doc
 * comment). Runs as a BullMQ `Worker` INSIDE this same `apps/api`
 * process, not a separate deployable — unlike `workers/notification-worker`
 * (ADR-001's ONE deliberate monolith exception, for a process that must
 * run as a continuous, independent consumer), report generation is a
 * bounded, per-request-triggered job with no standing-process rationale
 * of its own; adding a SECOND separate worker package here would expand
 * that ADR's exception without new authorization. The async-ness the
 * IMPLEMENTATION_PLAN.md test note asks for ("large export doesn't block
 * the request thread") comes from the queue+worker split itself — the
 * HTTP request returns 202 immediately; this class processes the job on
 * a later event-loop turn, not synchronously inside the request handler.
 */
@Injectable()
export class ReportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportWorkerService.name);
  private worker!: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    @Inject(NOTIFICATIONS_REDIS_CONNECTION) private readonly connection: IORedis,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      REPORTS_QUEUE_NAME,
      async (job: Job<{ reportJobId: string }>) => this.process(job.data.reportJobId),
      { connection: this.connection, concurrency: 3 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(reportJobId: string): Promise<void> {
    const job = await this.prisma.reportJob.findUnique({ where: { id: reportJobId } });
    if (!job || job.status !== ReportJobStatus.PENDING) {
      return; // already processed or gone — idempotent no-op, same posture as `processNotification`'s own terminal-state guard
    }

    await this.prisma.reportJob.update({ where: { id: reportJobId }, data: { status: ReportJobStatus.RUNNING } });

    try {
      const table = await this.buildTable(job.reportType, job.examSessionId);
      const file = await writeReportFile(table, job.format);
      const session = await this.prisma.examSession.findUnique({
        where: { id: job.examSessionId },
        select: { name: true, sessionDate: true },
      });
      const filename = buildFilename(job.reportType, job.examSessionId, session, file.extension);

      const resultUrl = `/report-jobs/${reportJobId}/download`;
      // BR-042 outbox discipline: the COMPLETED status write and the
      // notification queue happen in the SAME transaction (ARCHITECTURE.md
      // line 809/889: "delivered via signed URL + notification") — the
      // requesting admin's OWN user id is the recipient
      // (ReportJob.requestedByAdminId IS a users.id, same convention as
      // ExamSession.createdByAdminId).
      await this.prisma.$transaction(async (tx) => {
        await tx.reportJob.update({
          where: { id: reportJobId },
          data: {
            status: ReportJobStatus.COMPLETED,
            resultData: file.data,
            resultContentType: file.contentType,
            resultFilename: filename,
            resultUrl,
            completedAt: new Date(),
          },
        });
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.ADMIN,
          recipientId: job.requestedByAdminId,
          eventType: NotificationEventType.REPORT_READY,
          entityId: reportJobId,
          entityVersion: ReportJobStatus.COMPLETED,
          payload: {
            report_job_id: reportJobId,
            report_type: job.reportType,
            // Human-readable fields so the notification can say WHICH report for WHICH exam.
            report_label: REPORT_LABELS[job.reportType],
            session_name: session?.name ?? null,
            filename,
            download_url: resultUrl,
          },
        });
      });
    } catch (err) {
      this.logger.error(`Report job ${reportJobId} failed: ${(err as Error).message}`);
      await this.prisma.reportJob.update({
        where: { id: reportJobId },
        data: { status: ReportJobStatus.FAILED, errorMessage: (err as Error).message },
      });
    }
  }

  /**
   * Fresh queries at PROCESSING time, not creation time — IMPLEMENTATION_PLAN.md's
   * own test note ("partial data ... reflects current state accurately")
   * is satisfied structurally: nothing here reads a cached snapshot from
   * when the job was enqueued.
   */
  private async buildTable(reportType: ReportType, examSessionId: string) {
    switch (reportType) {
      case ReportType.ATTENDANCE: {
        const rows = await this.prisma.attendance.findMany({
          where: { quizStudentAssignment: { examSessionId } },
          include: { quizStudentAssignment: { include: { student: true, quiz: true } }, seat: true },
          orderBy: { markedAt: 'asc' },
        });
        return buildAttendanceReportTable(rows);
      }
      case ReportType.SEATING_PLAN: {
        const plans = await this.prisma.seatingPlan.findMany({
          where: { examSessionId },
          include: {
            room: true,
            assignments: { include: { seat: true, student: true, quiz: true } },
          },
        });
        return buildSeatingPlanReportTable(plans);
      }
      case ReportType.INCIDENT_REPORT: {
        const incidents = await this.prisma.incident.findMany({
          where: { examSessionId },
          include: { student: true, room: true, seat: true, reportedByFaculty: true },
          orderBy: { createdAt: 'asc' },
        });
        return buildIncidentReportTable(incidents);
      }
      case ReportType.ROOM_UTILIZATION: {
        const allocatedRooms = await this.prisma.examSessionRoom.findMany({
          where: { examSessionId },
          include: { room: true },
        });
        // ONE grouped query for seat-usage counts, not one query per room
        // (avoids the N+1 pattern the user's own instructions call out).
        const seatCounts = await this.prisma.seatingAssignment.groupBy({
          by: ['seatId'],
          where: { seatingPlan: { examSessionId } },
          _count: true,
        });
        const seatIds = seatCounts.map((c) => c.seatId);
        const seatToRoom = seatIds.length
          ? await this.prisma.roomSeat.findMany({ where: { id: { in: seatIds } }, select: { id: true, roomId: true } })
          : [];
        const roomIdBySeatId = new Map(seatToRoom.map((s) => [s.id, s.roomId]));
        const usedByRoomId = new Map<string, number>();
        for (const c of seatCounts) {
          const roomId = roomIdBySeatId.get(c.seatId);
          if (roomId) {
            usedByRoomId.set(roomId, (usedByRoomId.get(roomId) ?? 0) + c._count);
          }
        }
        return buildRoomUtilizationReportTable(
          allocatedRooms.map((r) => ({
            room: r.room,
            allocatedCapacity: r.allocatedCapacity,
            seatsUsed: usedByRoomId.get(r.roomId) ?? 0,
          })),
        );
      }
      default: {
        const exhaustiveCheck: never = reportType;
        throw new Error(`Unknown report type: ${String(exhaustiveCheck)}`);
      }
    }
  }
}

const REPORT_LABELS: Record<ReportType, string> = {
  [ReportType.ATTENDANCE]: 'Attendance Report',
  [ReportType.SEATING_PLAN]: 'Seating Plan Report',
  [ReportType.INCIDENT_REPORT]: 'Incident Report',
  [ReportType.ROOM_UTILIZATION]: 'Room Utilization Report',
};

/**
 * A human-readable download filename — the exam session's own name and date,
 * not its raw UUID. Falls back to the UUID only if the session no longer exists.
 */
function buildFilename(
  reportType: ReportType,
  examSessionId: string,
  session: { name: string; sessionDate: Date } | null,
  extension: string,
): string {
  const sessionSlug = session ? `${slugify(session.name)}-${session.sessionDate.toISOString().slice(0, 10)}` : examSessionId;
  return `${slugify(reportType)}-${sessionSlug}.${extension}`;
}

/** Lowercase, hyphen-separated, filesystem-safe — e.g. "Cyber quiz 1 — Exam" -> "cyber-quiz-1-exam". */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}
