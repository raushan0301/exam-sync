import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ReportJob, ReportJobStatus, ReportType } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REPORTS_QUEUE } from '../../common/queue/queue.constants';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService } from '../exam-session';
import { CreateReportDto } from './dto/create-report.dto';

/**
 * Owns `report_jobs` (Phase 19, IMPLEMENTATION_PLAN.md: "async report
 * generation ... async export jobs, signed URL delivery via
 * notification"). This class is the producer half only — it creates the
 * `PENDING` job row and enqueues it; `ReportWorkerService` (this same
 * process, `common/queue/`-adjacent infrastructure) is the consumer that
 * actually runs the query + writes the file.
 *
 * All 4 report-creation endpoints and the status/download reads are
 * ADMIN-only per API_CONTRACT.md's "Reports" table — no FACULTY/STUDENT
 * scoping exists for this module at all (unlike `attendance`/`incidents`
 * own resource-level scoping), so this service never checks
 * `actor.roles` beyond what the controller's `@Roles(ROLE.ADMIN)` already
 * enforces.
 */
const ENQUEUE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly examSessionsService: ExamSessionsService,
    @Inject(REPORTS_QUEUE) private readonly reportsQueue: Queue,
  ) {}

  async create(reportType: ReportType, dto: CreateReportDto, actor: AuthenticatedUser): Promise<ReportJob> {
    await this.examSessionsService.findById(dto.exam_session_id); // 404 if the session doesn't exist

    const job = await this.prisma.reportJob.create({
      data: {
        reportType,
        format: dto.format,
        examSessionId: dto.exam_session_id,
        requestedByAdminId: actor.id,
      },
    });

    try {
      await withTimeout(
        this.reportsQueue.add('generate', { reportJobId: job.id }, { jobId: job.id, attempts: 1 }),
        ENQUEUE_TIMEOUT_MS,
      );
    } catch (err) {
      // Redis down/unreachable: ioredis (maxRetriesPerRequest: null, required by BullMQ's
      // Worker on the shared connection) would otherwise queue this command forever and the
      // HTTP request would hang. Fail the row so no PENDING orphan lingers — if the stuck
      // `add` ever completes later, the worker's `status !== PENDING` guard skips it.
      this.logger.error(`Could not enqueue report job ${job.id}: ${(err as Error).message}`);
      await this.prisma.reportJob.update({
        where: { id: job.id },
        data: { status: ReportJobStatus.FAILED, errorMessage: 'Report queue unavailable' },
      });
      throw new ServiceUnavailableException('The report service is temporarily unavailable. Please try again shortly.');
    }

    return job;
  }

  /** `GET /report-jobs/{id}` — "status + download URL when ready" (API_CONTRACT.md). */
  async findById(id: string): Promise<ReportJob> {
    const job = await this.prisma.reportJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException();
    }
    return job;
  }

  /**
   * `GET /report-jobs/{id}/download` — disclosed addition (see
   * `ReportJob`'s own schema doc comment): the concrete implementation of
   * the "signed URL" `result_url` points to, since no object storage is
   * wired anywhere in this codebase.
   */
  async download(id: string): Promise<{ data: Buffer; contentType: string; filename: string }> {
    const job = await this.findById(id);
    if (job.status !== ReportJobStatus.COMPLETED || !job.resultData) {
      throw new ConflictException(`Report is in status "${job.status}" — not ready to download.`);
    }
    return {
      data: Buffer.from(job.resultData),
      contentType: job.resultContentType ?? 'application/octet-stream',
      filename: job.resultFilename ?? `report-${id}`,
    };
  }
}
