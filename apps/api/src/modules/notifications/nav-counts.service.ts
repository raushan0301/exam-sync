import { Injectable } from '@nestjs/common';
import {
  ExamSessionStatus,
  IncidentStatus,
  NotificationChannel,
  QuizStatus,
  RoomRequestStatus,
  SuspensionRequestStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Sidebar keys whose badge means "new since you last opened the page". */
export const SEEN_KEYS = ['assignments', 'invigilation-duties', 'incidents'] as const;
export type SeenKey = (typeof SEEN_KEYS)[number];

export type NavCounts = Record<string, number>;

/**
 * `GET /me/nav-counts` — the little red numbers in the sidebar. One call,
 * shaped by the caller's role, so the shell polls a single cheap endpoint.
 *
 * Two kinds of count:
 *  - "waiting on you" (approval queue, open incidents, unread notifications,
 *    rejected quizzes): a live count of rows in that state; it drops as the
 *    work is done.
 *  - "new since you looked" (assignments, invigilation duties, incident
 *    outcomes): rows created after the user last opened that page
 *    (`user_nav_seen`). The first time a user is seen the baseline is "now",
 *    so existing history is not reported as new.
 */
@Injectable()
export class NavCountsService {
  constructor(private readonly prisma: PrismaService) {}

  async countsFor(actor: AuthenticatedUser): Promise<NavCounts> {
    const counts: NavCounts = {};
    counts.notifications = await this.prisma.notification.count({
      where: { recipientId: actor.id, channel: NotificationChannel.IN_APP, readAt: null },
    });

    if (actor.roles.includes(ROLE.ADMIN)) {
      const [approvals, suspensions, roomRequests, incidents] = await Promise.all([
        this.prisma.quiz.count({ where: { status: QuizStatus.SUBMITTED } }),
        this.prisma.examSessionSuspensionRequest.count({ where: { status: SuspensionRequestStatus.PENDING } }),
        this.prisma.examSessionRoomRequest.count({ where: { status: RoomRequestStatus.PENDING } }),
        this.prisma.incident.count({ where: { status: IncidentStatus.OPEN } }),
      ]);
      counts['quizzes.approval'] = approvals;
      counts['suspension-requests'] = suspensions;
      counts['room-requests'] = roomRequests;
      counts.incidents = incidents;
    }

    const isFaculty = actor.roles.includes(ROLE.FACULTY) || actor.roles.includes(ROLE.INVIGILATOR);
    if (isFaculty && !actor.roles.includes(ROLE.ADMIN)) {
      const faculty = await this.prisma.faculty.findUnique({ where: { userId: actor.id }, select: { id: true } });
      if (faculty) {
        const seen = await this.seenAt(actor.id);
        const [rejected, assignments, duties, incidents] = await Promise.all([
          this.prisma.quiz.count({ where: { createdByFacultyId: faculty.id, status: QuizStatus.REJECTED } }),
          this.prisma.facultySubjectBatchAssignment.count({
            where: { facultyId: faculty.id, endedAt: null, createdAt: { gt: seen.assignments } },
          }),
          this.prisma.examInvigilator.count({
            where: {
              facultyId: faculty.id,
              assignedAt: { gt: seen['invigilation-duties'] },
              examSession: { status: { notIn: [ExamSessionStatus.CANCELLED, ExamSessionStatus.COMPLETED] } },
            },
          }),
          this.prisma.incident.count({
            where: { reportedByFacultyId: faculty.id, resolvedAt: { gt: seen.incidents } },
          }),
        ]);
        counts['my-quizzes'] = rejected;
        counts.assignments = assignments;
        counts['invigilation-duties'] = duties;
        counts.incidents = incidents;
      }
    }
    return counts;
  }

  async markSeen(actor: AuthenticatedUser, key: SeenKey): Promise<void> {
    const now = new Date();
    await this.prisma.userNavSeen.upsert({
      where: { userId_key: { userId: actor.id, key } },
      create: { userId: actor.id, key, seenAt: now },
      update: { seenAt: now },
    });
  }

  /** Last-seen time per key; a key never seen is baselined to "now" (and stored) so old rows are not "new". */
  private async seenAt(userId: string): Promise<Record<SeenKey, Date>> {
    const rows = await this.prisma.userNavSeen.findMany({ where: { userId } });
    const byKey = new Map(rows.map((r) => [r.key, r.seenAt]));
    const now = new Date();
    const missing = SEEN_KEYS.filter((k) => !byKey.has(k));
    if (missing.length > 0) {
      await this.prisma.userNavSeen.createMany({
        data: missing.map((key) => ({ userId, key, seenAt: now })),
        skipDuplicates: true,
      });
    }
    return Object.fromEntries(SEEN_KEYS.map((k) => [k, byKey.get(k) ?? now])) as Record<SeenKey, Date>;
  }
}
