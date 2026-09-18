import { seededShuffle } from './deterministic-random';
import { AntiCheatingFallbackReason, SeatAssignment, SeatInput, StudentToSeatInput } from './types';

/** ARCHITECTURE.md §U step 4: "bounded to K passes, e.g., K=3." */
const REPAIR_PASSES = 3;

export interface AntiCheatingPlacementResult {
  assignments: SeatAssignment[];
  unseated: StudentToSeatInput[];
  fallbackReason?: AntiCheatingFallbackReason;
}

/**
 * ============================================================================
 * PHASE 14 — ANTI-CHEATING SEATING ALGORITHM (pure, framework-independent)
 * ============================================================================
 * ARCHITECTURE.md §U, "Greedy graph-coloring with backtrack-limited local
 * repair" — implemented as close to the doc's literal 6-step algorithm as
 * practical:
 *   1. Seats are graph nodes; edges connect 4-directionally adjacent seats.
 *   2. Greedy fill: row-major seat order; for each seat, pick the
 *      remaining student whose (subject, batch, quiz) label collides
 *      least with already-placed ADJACENT seats, tie-broken by preferring
 *      the subject with the most students still unplaced (a welfare/
 *      degree heuristic — keeps future placements flexible).
 *   3. If every remaining candidate collides with something adjacent,
 *      the least-bad (fewest collisions) one is placed anyway — never
 *      leaves a seat empty while students remain, unlike a HARD
 *      constraint failure.
 *   4. Local repair: up to `REPAIR_PASSES` sweeps, each looking for a
 *      pairwise swap between a still-violating seat and some OTHER,
 *      NON-ADJACENT occupied seat that reduces total collisions at both
 *      locations without making anything worse.
 *   6. Single-subject fallback (step 5, "validate", is `validateSeating`
 *      — a separate, independent pure function per ADR-004, not
 *      duplicated here): when the room's roster has no subject diversity
 *      at all, graph-coloring has nothing to exploit, so this function
 *      steps down a fallback chain instead — alternate batch, then
 *      checkerboard spacing, then pure randomization — and reports WHICH
 *      rung fired via `fallbackReason` (ARCHITECTURE.md §Q: "WARNING →
 *      falls back to spacing/randomization soft constraints" — surfaced
 *      to the caller explicitly, never silently).
 *
 * `seats` must already be row-major sorted, active-only (the caller,
 * `generate-seating.ts`, guarantees this — same convention as every other
 * strategy there).
 */
export function generateAntiCheatingPlacement(
  seats: SeatInput[],
  students: StudentToSeatInput[],
  seed: string,
): AntiCheatingPlacementResult {
  if (students.length === 0) {
    return { assignments: [], unseated: [] };
  }

  const distinctSubjects = new Set(students.map((s) => s.subjectId)).size;
  if (distinctSubjects <= 1) {
    return singleSubjectFallback(seats, students, seed);
  }

  const { assignments, unseated } = greedyGraphColoringFill(seats, students);
  const repaired = localRepair(seats, assignments, students);
  return { assignments: repaired, unseated };
}

function singleSubjectFallback(
  seats: SeatInput[],
  students: StudentToSeatInput[],
  seed: string,
): AntiCheatingPlacementResult {
  const distinctBatches = new Set(students.map((s) => s.batchId)).size;

  if (distinctBatches > 1) {
    const ordered = roundRobinByBatch(canonicalOrder(students));
    return { ...zip(ordered, seats), fallbackReason: 'SINGLE_SUBJECT_ALTERNATE_BATCH' };
  }

  // "checkerboard empty-seat spacing (every other seat empty) if capacity allows."
  const canCheckerboard = seats.length >= students.length * 2;
  if (canCheckerboard) {
    const checkerboardSeats = seats.filter((s) => (s.rowIndex + s.colIndex) % 2 === 0);
    return { ...zip(canonicalOrder(students), checkerboardSeats), fallbackReason: 'SINGLE_SUBJECT_CHECKERBOARD_SPACING' };
  }

  const shuffled = seededShuffle(canonicalOrder(students), seed);
  return { ...zip(shuffled, seats), fallbackReason: 'SINGLE_SUBJECT_RANDOMIZED' };
}

function greedyGraphColoringFill(
  seats: SeatInput[],
  students: StudentToSeatInput[],
): { assignments: SeatAssignment[]; unseated: StudentToSeatInput[] } {
  const placedBySeatId = new Map<string, StudentToSeatInput>();
  const pool = [...students];
  const assignments: SeatAssignment[] = [];

  for (const seat of seats) {
    if (pool.length === 0) {
      break;
    }

    const adjacentPlaced = seats
      .filter((s) => s.id !== seat.id && areAdjacent(s, seat))
      .map((s) => placedBySeatId.get(s.id))
      .filter((s): s is StudentToSeatInput => Boolean(s));

    let bestIndex = 0;
    let bestCollisions = Infinity;
    let bestDegree = -1;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const collisions = countLabelCollisions(candidate, adjacentPlaced);
      // Degree heuristic: prefer the subject with the most students still
      // waiting — placing a "rare" subject now risks it having nowhere
      // safe to go later; placing a "common" one is always safe to defer.
      const degree = pool.reduce((n, p) => (p.subjectId === candidate.subjectId ? n + 1 : n), 0);
      if (collisions < bestCollisions || (collisions === bestCollisions && degree > bestDegree)) {
        bestIndex = i;
        bestCollisions = collisions;
        bestDegree = degree;
      }
    }

    const [student] = pool.splice(bestIndex, 1);
    placedBySeatId.set(seat.id, student);
    assignments.push({ seatId: seat.id, studentId: student.studentId, quizId: student.quizId });
  }

  return { assignments, unseated: pool };
}

function localRepair(
  seats: SeatInput[],
  assignments: SeatAssignment[],
  students: StudentToSeatInput[],
): SeatAssignment[] {
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const studentById = new Map(students.map((s) => [s.studentId, s]));
  const current = assignments.map((a) => ({ ...a }));

  const collisionsIfPlaced = (
    targetSeatId: string,
    candidate: StudentToSeatInput,
    excludeSeatIds: ReadonlySet<string>,
  ): number => {
    const targetSeat = seatById.get(targetSeatId);
    if (!targetSeat) {
      return 0;
    }
    let count = 0;
    for (const other of current) {
      if (excludeSeatIds.has(other.seatId)) {
        continue;
      }
      const otherSeat = seatById.get(other.seatId);
      if (!otherSeat || !areAdjacent(targetSeat, otherSeat)) {
        continue;
      }
      const otherStudent = studentById.get(other.studentId);
      if (!otherStudent) {
        continue;
      }
      count += countLabelCollisions(candidate, [otherStudent]);
    }
    return count;
  };

  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let improved = false;

    for (const a of current) {
      const studentA = studentById.get(a.studentId);
      if (!studentA) {
        continue;
      }
      const currentViolations = collisionsIfPlaced(a.seatId, studentA, new Set([a.seatId]));
      if (currentViolations === 0) {
        continue;
      }

      const seatA = seatById.get(a.seatId)!;
      for (const b of current) {
        if (b.seatId === a.seatId) {
          continue;
        }
        const seatB = seatById.get(b.seatId)!;
        if (areAdjacent(seatA, seatB)) {
          continue; // §U: swap candidates must be non-adjacent to the violating seat.
        }
        const studentB = studentById.get(b.studentId);
        if (!studentB) {
          continue;
        }

        const excludeBoth = new Set([a.seatId, b.seatId]);
        const before =
          collisionsIfPlaced(a.seatId, studentA, new Set([a.seatId])) +
          collisionsIfPlaced(b.seatId, studentB, new Set([b.seatId]));
        const after =
          collisionsIfPlaced(a.seatId, studentB, excludeBoth) + collisionsIfPlaced(b.seatId, studentA, excludeBoth);

        if (after < before) {
          const aStudentId = a.studentId;
          const aQuizId = a.quizId;
          a.studentId = b.studentId;
          a.quizId = b.quizId;
          b.studentId = aStudentId;
          b.quizId = aQuizId;
          improved = true;
          break;
        }
      }
    }

    if (!improved) {
      break; // Converged — no point spending the remaining passes.
    }
  }

  return current;
}

function countLabelCollisions(candidate: StudentToSeatInput, against: StudentToSeatInput[]): number {
  let collisions = 0;
  for (const other of against) {
    if (other.subjectId === candidate.subjectId) {
      collisions += 1;
    }
    if (other.batchId === candidate.batchId) {
      collisions += 1;
    }
    if (other.quizId === candidate.quizId) {
      collisions += 1;
    }
  }
  return collisions;
}

function areAdjacent(a: SeatInput, b: SeatInput): boolean {
  return Math.abs(a.rowIndex - b.rowIndex) + Math.abs(a.colIndex - b.colIndex) === 1;
}

function canonicalOrder(students: StudentToSeatInput[]): StudentToSeatInput[] {
  return [...students].sort(
    (a, b) => a.quizId.localeCompare(b.quizId) || a.studentId.localeCompare(b.studentId),
  );
}

function roundRobinByBatch(students: StudentToSeatInput[]): StudentToSeatInput[] {
  const groups = new Map<string, StudentToSeatInput[]>();
  for (const student of students) {
    const group = groups.get(student.batchId);
    if (group) {
      group.push(student);
    } else {
      groups.set(student.batchId, [student]);
    }
  }
  const groupList = [...groups.values()];
  const result: StudentToSeatInput[] = [];
  let remaining = students.length;
  let cursor = 0;
  while (remaining > 0) {
    const group = groupList[cursor % groupList.length];
    if (group.length > 0) {
      result.push(group.shift() as StudentToSeatInput);
      remaining -= 1;
    }
    cursor += 1;
  }
  return result;
}

function zip(
  students: StudentToSeatInput[],
  seats: SeatInput[],
): { assignments: SeatAssignment[]; unseated: StudentToSeatInput[] } {
  const assignments: SeatAssignment[] = [];
  const count = Math.min(students.length, seats.length);
  for (let i = 0; i < count; i++) {
    assignments.push({ seatId: seats[i].id, studentId: students[i].studentId, quizId: students[i].quizId });
  }
  return { assignments, unseated: students.slice(count) };
}
