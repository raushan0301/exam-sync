import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamSession, ExamSessionStatus, Prisma, QuizStudentAssignmentStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService } from '../exam-session';
import { ConflictEngineService, ConflictDetail } from '../conflict-engine';
import { RoomsService } from '../rooms';
import { AllocateRoomsDto } from './dto/allocate-rooms.dto';

interface StudentGroup {
  quizId: string;
  count: number;
}

interface Placement {
  roomId: string;
  quizId: string;
  count: number;
}

/**
 * Owns `exam_session_rooms` (ARCHITECTURE.md §S, IMPLEMENTATION_PLAN.md
 * Phase 12: "Best-Fit Decreasing allocation algorithm, exam_session_rooms").
 *
 * State-machine note (disclosed interpretation): ARCHITECTURE.md's Exam
 * Session table has TWO transitions bracketing this phase —
 * ASSIGNING_STUDENTS→ROOM_ALLOCATION ("Admin", precondition "assignment
 * job complete") and ROOM_ALLOCATION→SEATING_GENERATION ("Admin",
 * precondition "rooms allocated, capacity sufficient"). No separate
 * endpoint exists anywhere in API_CONTRACT.md for the first transition —
 * Phase 9's `assign-students` is already synchronous, so "assignment job
 * complete" is true the instant that call returns, which is exactly when
 * a session sits at ASSIGNING_STUDENTS. This service therefore treats
 * `allocate` as requiring status ASSIGNING_STUDENTS and, on success,
 * moves the session straight to SEATING_GENERATION in the SAME
 * transaction — both documented transitions collapse into one atomic
 * step because nothing observable ever distinguishes a durably-persisted
 * ROOM_ALLOCATION state (a failed attempt rolls the whole transaction
 * back to ASSIGNING_STUDENTS regardless of any intermediate value).
 * Calling `allocate` again afterward correctly 409s (not
 * ASSIGNING_STUDENTS) — the same session-level idempotency guard
 * established in every prior phase.
 */
@Injectable()
export class RoomAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly roomsService: RoomsService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/rooms/allocate` (ADMIN). Candidate rooms
   * come from `dto.room_ids` (manual) or an auto-search via
   * `RoomsService.findAvailable` optionally narrowed by
   * `dto.candidate_room_ids` (algorithmic). Every candidate room is then
   * row-locked (`SELECT ... FOR UPDATE`, ADR-003 mechanism (a): "row lock
   * on candidate room rows during allocation") inside one transaction,
   * re-checked for real conflicts (BR-018/BR-022, via the Conflict
   * Engine), capacity-checked in aggregate (BR-021, EC-011 — all-or-
   * nothing on shortfall), then packed with Best-Fit Decreasing
   * (ARCHITECTURE.md §S) and persisted. The `EXCLUDE` constraint on
   * `exam_session_rooms` (BR-018) is the final backstop underneath all of
   * this, per ADR-003's tiered strategy — reachable only if the lock
   * itself is somehow bypassed, defended against here too (see
   * `mapExclusionViolation`).
   */
  async allocate(
    examSessionId: string,
    dto: AllocateRoomsDto,
    actor: AuthenticatedUser,
  ): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status !== ExamSessionStatus.ASSIGNING_STUDENTS) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and rooms can only be allocated while ASSIGNING_STUDENTS.`,
      );
    }

    const groups = await this.getStudentGroupsByQuiz(examSessionId);
    const totalStudents = groups.reduce((sum, g) => sum + g.count, 0);
    if (totalStudents === 0) {
      throw new ConflictException('This session has no ASSIGNED students to allocate rooms for.');
    }

    const candidateRoomIds = await this.resolveCandidateRoomIds(dto, session);
    if (candidateRoomIds.length === 0) {
      throw new BadRequestException('At least one candidate room is required.');
    }

    const updatedSession = await this.prisma
      .$transaction(async (tx) => {
        // ADR-003 mechanism (a): row-lock every candidate room BEFORE any
        // conflict/capacity check, so a concurrent allocator racing for
        // the same room blocks here and re-observes our committed state
        // once we finish, rather than both proceeding on stale reads.
        const lockedRooms = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM rooms WHERE id = ANY(${candidateRoomIds}::uuid[]) FOR UPDATE`,
        );
        if (lockedRooms.length !== candidateRoomIds.length) {
          throw new NotFoundException('One or more candidate rooms do not exist.');
        }

        const conflictResult = await this.conflictEngine.checkRoomAllocation(
          {
            examSessionId,
            roomIds: candidateRoomIds,
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
          },
          tx,
        );
        if (conflictResult.hard.length > 0) {
          throw new ConflictException({
            message: 'One or more candidate rooms are unavailable.',
            details: conflictResult.hard,
          });
        }

        const activeSeatCounts = await this.getActiveSeatCounts(tx, candidateRoomIds);
        const totalCapacity = candidateRoomIds.reduce(
          (sum, id) => sum + (activeSeatCounts.get(id) ?? 0),
          0,
        );
        if (totalCapacity < totalStudents) {
          const shortfallDetail: ConflictDetail = {
            type: 'ROOM_UNAVAILABLE',
            message: `Shortfall: ${totalStudents - totalCapacity} student(s), no additional capacity in the selected rooms (${totalCapacity} active seat(s) available for ${totalStudents} student(s)).`,
          };
          throw new ConflictException({
            message: 'Insufficient room capacity for this session — allocation aborted (EC-011).',
            details: [shortfallDetail],
          });
        }

        const placements = this.bestFitDecreasing(groups, candidateRoomIds, activeSeatCounts);
        const perRoomTotals = new Map<string, number>();
        const placementsByRoom = new Map<string, Placement[]>();
        for (const p of placements) {
          perRoomTotals.set(p.roomId, (perRoomTotals.get(p.roomId) ?? 0) + p.count);
          const existing = placementsByRoom.get(p.roomId);
          if (existing) {
            existing.push(p);
          } else {
            placementsByRoom.set(p.roomId, [p]);
          }
        }

        for (const [roomId, allocatedCapacity] of perRoomTotals) {
          const examSessionRoom = await tx.examSessionRoom.create({
            data: {
              examSessionId,
              roomId,
              allocatedCapacity,
              sessionDate: session.sessionDate,
              startTime: session.startTime,
              endTime: session.endTime,
            },
          });

          // Phase 13 needs this per-(room, quiz) breakdown — otherwise a
          // session whose cohort was split across multiple rooms (EC-005)
          // has no way to recover which students belong in which room;
          // the aggregate `allocatedCapacity` above is ambiguous once more
          // than one quiz/room is involved. Persists exactly what the
          // packer above already computed, nothing new decided here.
          for (const placement of placementsByRoom.get(roomId) ?? []) {
            await tx.examSessionRoomQuiz.create({
              data: {
                examSessionRoomId: examSessionRoom.id,
                quizId: placement.quizId,
                studentCount: placement.count,
              },
            });
          }
        }

        const updated = await tx.examSession.update({
          where: { id: examSessionId },
          data: { status: ExamSessionStatus.SEATING_GENERATION, version: { increment: 1 } },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'UPDATE',
            entityType: 'ExamSession',
            entityId: examSessionId,
            oldValue: { status: session.status },
            newValue: { status: updated.status, roomIds: candidateRoomIds },
          },
          tx,
        );

        return updated;
      })
      .catch((err) => this.mapExclusionViolation(err));

    return updatedSession;
  }

  private async resolveCandidateRoomIds(
    dto: AllocateRoomsDto,
    session: ExamSession,
  ): Promise<string[]> {
    if (!dto.auto) {
      if (!dto.room_ids || dto.room_ids.length === 0) {
        throw new BadRequestException('room_ids is required when not using auto allocation.');
      }
      return dto.room_ids;
    }

    if (dto.candidate_room_ids && dto.candidate_room_ids.length > 0) {
      return dto.candidate_room_ids;
    }

    const available = await this.roomsService.findAvailable({
      date: session.sessionDate.toISOString().slice(0, 10),
      start_time: session.startTime.toISOString().slice(11, 16),
      end_time: session.endTime.toISOString().slice(11, 16),
    });
    return available.map((r) => r.id);
  }

  /** `quiz_student_assignment` rows grouped by quiz (== subject), sorted largest-first for Best-Fit Decreasing. */
  private async getStudentGroupsByQuiz(examSessionId: string): Promise<StudentGroup[]> {
    const grouped = await this.prisma.quizStudentAssignment.groupBy({
      by: ['quizId'],
      where: { examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED },
      _count: { studentId: true },
    });
    return grouped
      .map((g) => ({ quizId: g.quizId, count: g._count.studentId }))
      .sort((a, b) => b.count - a.count);
  }

  private async getActiveSeatCounts(
    tx: Prisma.TransactionClient,
    roomIds: string[],
  ): Promise<Map<string, number>> {
    const grouped = await tx.roomSeat.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomIds }, isActive: true },
      _count: { id: true },
    });
    const counts = new Map<string, number>(roomIds.map((id) => [id, 0]));
    for (const g of grouped) {
      counts.set(g.roomId, g._count.id);
    }
    return counts;
  }

  /**
   * ARCHITECTURE.md §S: for each student group (largest subject first),
   * place it in the candidate room leaving the least remaining capacity
   * that still fits the WHOLE group ("best fit"); if no single room fits
   * the whole remaining chunk, split it — consuming the room with the
   * MOST remaining capacity first, to minimize how many rooms a split
   * group spans (EC-005: "class larger than any single room" is an
   * explicitly allowed scenario, though §S gives no exact split
   * algorithm — this is a disclosed, reasonable choice). Deterministic:
   * candidate rooms are iterated in the caller-supplied order (itself
   * either the admin's explicit `room_ids` or `findAvailable`'s
   * capacity-ascending order), with ties broken by that same stable order.
   */
  private bestFitDecreasing(
    groups: StudentGroup[],
    roomIds: string[],
    capacities: Map<string, number>,
  ): Placement[] {
    const remaining = new Map(roomIds.map((id) => [id, capacities.get(id) ?? 0]));
    const placements: Placement[] = [];

    for (const group of groups) {
      let toPlace = group.count;
      while (toPlace > 0) {
        const candidates = roomIds
          .map((id) => ({ id, cap: remaining.get(id) ?? 0 }))
          .filter((r) => r.cap > 0);
        if (candidates.length === 0) {
          break; // Should be unreachable — aggregate capacity was pre-checked — but never infinite-loop.
        }

        const exactFit = candidates
          .filter((r) => r.cap >= toPlace)
          .sort((a, b) => a.cap - b.cap)[0];

        if (exactFit) {
          placements.push({ roomId: exactFit.id, quizId: group.quizId, count: toPlace });
          remaining.set(exactFit.id, exactFit.cap - toPlace);
          toPlace = 0;
        } else {
          const largest = candidates.sort((a, b) => b.cap - a.cap)[0];
          placements.push({ roomId: largest.id, quizId: group.quizId, count: largest.cap });
          remaining.set(largest.id, 0);
          toPlace -= largest.cap;
        }
      }
    }

    return placements;
  }

  /**
   * ADR-003 Implementation Notes: map raw constraint-violation errors to a
   * clean 409, never let them leak. The EXCLUDE constraint's violation
   * surfaces as a `PrismaClientUnknownRequestError` (Prisma has no
   * dedicated error code for EXCLUDE, unlike `P2002` for UNIQUE) carrying
   * Postgres's own `23P01 exclusion_violation` in its message — this is
   * the final backstop, reachable only if the row lock were somehow
   * bypassed; every normal path is already caught by
   * `checkRoomAllocation` above.
   */
  private mapExclusionViolation(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      (err.message.includes('23P01') || err.message.includes('exclusion constraint'))
    ) {
      throw new ConflictException(
        'One or more candidate rooms were concurrently allocated to an overlapping session (BR-018).',
      );
    }
    throw err;
  }
}
