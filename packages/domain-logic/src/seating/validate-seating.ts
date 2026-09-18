import {
  HardViolation,
  SeatAssignment,
  SeatInput,
  SoftViolation,
  StudentToSeatInput,
  ValidateSeatingInput,
  ValidateSeatingResult,
} from './types';

/**
 * ============================================================================
 * PHASE 13 — SEATING VALIDATION (pure, framework-independent)
 * ============================================================================
 * ADR-004's Implementation Notes: "Implement generation and validation as
 * two distinct pure functions ... so the validator can be unit-tested
 * against hand-constructed `seating_assignments` fixtures independent of
 * ever running the generator." This function shares NO state with
 * `generateSeating` and re-scans `input.assignments` from scratch — it
 * makes no assumption that they came from this package's own generator
 * (the NestJS caller re-fetches persisted rows before calling this, per
 * that same ADR, rather than reusing the generator's in-memory result).
 *
 * HARD constraints (ARCHITECTURE.md §V — violation blocks FINALIZE, BR-026):
 *  - one student per seat (BR-024), one seat per student (BR-025)
 *  - no inactive/disabled seat used
 *  - accessibility-required students placed only in accessible seats (BR-028)
 *  - every roster student has exactly one seat (an incomplete plan is not
 *    finalizable — §V doesn't spell this out as a separate bullet, but it
 *    is the necessary reading of BR-025 combined with "student cannot
 *    hold two seats": a valid plan gives every expected student exactly
 *    one, not zero, not two)
 *  - explicit student-pair separation (BR-029) — always empty today, see
 *    `types.ts`'s `separationPairs` doc comment
 *
 * SOFT constraints (§V — reported, never block FINALIZE): same-subject,
 * same-batch, same-quiz 4-directional adjacency.
 */
export function validateSeating(input: ValidateSeatingInput): ValidateSeatingResult {
  const seatsById = new Map(input.seats.map((s) => [s.id, s]));
  const rosterByStudentId = new Map(input.students.map((s) => [s.studentId, s]));
  const separationPairs = input.separationPairs ?? [];

  const hardViolations: HardViolation[] = [];

  const assignmentsBySeat = groupCount(input.assignments, (a) => a.seatId);
  const assignmentsByStudent = groupCount(input.assignments, (a) => a.studentId);

  for (const assignment of input.assignments) {
    if ((assignmentsBySeat.get(assignment.seatId) ?? 0) > 1) {
      hardViolations.push({
        type: 'DUPLICATE_SEAT',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Seat "${assignment.seatId}" is assigned to more than one student (BR-024).`,
      });
    }
    if ((assignmentsByStudent.get(assignment.studentId) ?? 0) > 1) {
      hardViolations.push({
        type: 'DUPLICATE_STUDENT',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Student "${assignment.studentId}" holds more than one seat in this plan (BR-025).`,
      });
    }

    const seat = seatsById.get(assignment.seatId);
    if (!seat) {
      hardViolations.push({
        type: 'UNKNOWN_SEAT',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Assignment references seat "${assignment.seatId}", which does not exist in this room.`,
      });
      continue;
    }
    if (!seat.isActive) {
      hardViolations.push({
        type: 'INACTIVE_SEAT',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Seat "${assignment.seatId}" is disabled and cannot be used.`,
      });
    }

    const rosterEntry = rosterByStudentId.get(assignment.studentId);
    if (!rosterEntry) {
      hardViolations.push({
        type: 'UNKNOWN_STUDENT',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Assignment references student "${assignment.studentId}", who is not in this plan's expected roster.`,
      });
    } else if (rosterEntry.requiresAccessibleSeat && !seat.isAccessible) {
      hardViolations.push({
        type: 'ACCESSIBILITY_MISMATCH',
        seatId: assignment.seatId,
        studentId: assignment.studentId,
        message: `Student "${assignment.studentId}" requires an accessible seat but was placed at "${assignment.seatId}", which is not accessible (BR-028).`,
      });
    }
  }

  for (const student of input.students) {
    if (!assignmentsByStudent.has(student.studentId)) {
      hardViolations.push({
        type: 'UNSEATED_STUDENT',
        studentId: student.studentId,
        message: `Student "${student.studentId}" has no seat assignment in this plan.`,
      });
    }
  }

  for (const [studentA, studentB] of separationPairs) {
    const seatA = findSeatFor(input.assignments, studentA);
    const seatB = findSeatFor(input.assignments, studentB);
    if (seatA && seatB && areAdjacent(seatsById.get(seatA), seatsById.get(seatB))) {
      hardViolations.push({
        type: 'SEPARATION_VIOLATION',
        seatId: seatA,
        studentId: studentA,
        message: `Students "${studentA}" and "${studentB}" are seated adjacently despite an explicit separation rule (BR-029).`,
      });
    }
  }

  const { softViolations, softConstraintScore } = computeSoftViolations(
    input.assignments,
    seatsById,
    rosterByStudentId,
  );

  return { hardViolations, softViolations, softConstraintScore };
}

function groupCount<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function findSeatFor(assignments: SeatAssignment[], studentId: string): string | undefined {
  return assignments.find((a) => a.studentId === studentId)?.seatId;
}

function areAdjacent(a: SeatInput | undefined, b: SeatInput | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const rowDiff = Math.abs(a.rowIndex - b.rowIndex);
  const colDiff = Math.abs(a.colIndex - b.colIndex);
  return rowDiff + colDiff === 1; // 4-directional (§T): shares a row or column, exactly one step away.
}

function computeSoftViolations(
  assignments: SeatAssignment[],
  seatsById: Map<string, SeatInput>,
  rosterByStudentId: Map<string, StudentToSeatInput>,
): { softViolations: SoftViolation[]; softConstraintScore: number } {
  const softViolations: SoftViolation[] = [];
  let totalAdjacentPairs = 0;

  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const seatA = seatsById.get(assignments[i].seatId);
      const seatB = seatsById.get(assignments[j].seatId);
      if (!areAdjacent(seatA, seatB)) {
        continue;
      }
      totalAdjacentPairs += 1;

      const studentA = rosterByStudentId.get(assignments[i].studentId);
      const studentB = rosterByStudentId.get(assignments[j].studentId);
      if (!studentA || !studentB) {
        continue;
      }

      const seatIdA = assignments[i].seatId;
      const seatIdB = assignments[j].seatId;

      if (studentA.subjectId === studentB.subjectId) {
        softViolations.push({
          type: 'SUBJECT_ADJACENCY',
          seatIdA,
          seatIdB,
          message: `Adjacent seats "${seatIdA}" and "${seatIdB}" both hold students of subject "${studentA.subjectId}".`,
        });
      }
      if (studentA.batchId === studentB.batchId) {
        softViolations.push({
          type: 'BATCH_ADJACENCY',
          seatIdA,
          seatIdB,
          message: `Adjacent seats "${seatIdA}" and "${seatIdB}" both hold students of batch "${studentA.batchId}".`,
        });
      }
      if (studentA.quizId === studentB.quizId) {
        softViolations.push({
          type: 'QUIZ_ADJACENCY',
          seatIdA,
          seatIdB,
          message: `Adjacent seats "${seatIdA}" and "${seatIdB}" both hold students of quiz "${studentA.quizId}".`,
        });
      }
    }
  }

  const violatingPairs = new Set(softViolations.map((v) => `${v.seatIdA}:${v.seatIdB}`)).size;
  const softConstraintScore = totalAdjacentPairs === 0 ? 1 : 1 - violatingPairs / totalAdjacentPairs;

  return { softViolations, softConstraintScore };
}
