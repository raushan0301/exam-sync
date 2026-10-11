import { generateMixedPlacement } from './mixed-placement';
import { generateSingleSubjectSpread, keepAlternateColumns } from './single-subject-spread';
import {
  GenerateSeatingInput,
  GenerateSeatingResult,
  SeatAssignment,
  SeatingStrategyName,
  SeatInput,
  StudentToSeatInput,
} from './types';

/**
 * Seating generation (pure, framework-independent). Four strategies, each a disclosed interpretation of
 * its name; all are deterministic — same (seats, students, strategy, seed) in ⇒ same assignments out.
 *
 *  - SEQUENTIAL: roster order, row by row.
 *  - ALTERNATE_SUBJECT / ALTERNATE_BATCH / SUBJECT_BATCH_MIX: fill row by row, each seat taking the group
 *    that clashes least with the seat to its left and the seat in front (so rows flip instead of repeating),
 *    with uneven groups spread out and, if spare seats exist, empty seats instead of same-group neighbours
 *    (see mixed-placement.ts). When that dimension has nothing to mix in the room (one
 *    subject, one batch, or both), the roll-number / batch / staggered-row spread is used instead and
 *    reported through `fallbackReason`.
 *
 * Pipeline: accessibility-required students are placed first into accessible seats (BR-028, HARD), then
 * everyone else fills the remaining active seats. Anyone who does not fit is returned in `unseated`,
 * never silently dropped — `validateSeating` turns that into a HARD violation.
 */
export function generateSeating(input: GenerateSeatingInput): GenerateSeatingResult {
  const activeSeatsAll = input.seats.filter((s) => s.isActive);
  const activeSeats = input.skipAlternateColumns ? keepAlternateColumns(activeSeatsAll) : activeSeatsAll;
  const accessibleSeats = rowMajor(activeSeats.filter((s) => s.isAccessible));
  const nonAccessibleSeats = rowMajor(activeSeats.filter((s) => !s.isAccessible));

  const accessibilityRequired = input.students.filter((s) => s.requiresAccessibleSeat);
  const everyoneElse = input.students.filter((s) => !s.requiresAccessibleSeat);

  const assignments: SeatAssignment[] = [];
  const unseated: StudentToSeatInput[] = [];

  // A mixing strategy whose dimension has nothing to mix in this room (one subject / one batch) would do
  // nothing useful, so it uses the roll-number / batch / staggered-row spread instead. SEQUENTIAL and
  // RANDOMIZED stay exactly as asked.
  const oneSubject = new Set(input.students.map((s) => s.subjectId)).size <= 1;
  const oneBatch = new Set(input.students.map((s) => s.batchId)).size <= 1;
  const mixingHasNothingToMix =
    (input.strategy === 'ALTERNATE_SUBJECT' && oneSubject) ||
    (input.strategy === 'ALTERNATE_BATCH' && oneBatch) ||
    (input.strategy === 'SUBJECT_BATCH_MIX' && oneSubject && oneBatch);
  if (mixingHasNothingToMix) {
    const seed = input.seed ?? '';
    const accessibleResult = generateSingleSubjectSpread(accessibleSeats, accessibilityRequired, `${seed}:accessible`);
    assignments.push(...accessibleResult.assignments);
    unseated.push(...accessibleResult.unseated);

    const usedAccessibleSeatIds = new Set(accessibleResult.assignments.map((a) => a.seatId));
    const remainingSeats = rowMajor([
      ...accessibleSeats.filter((s) => !usedAccessibleSeatIds.has(s.id)),
      ...nonAccessibleSeats,
    ]);
    const restResult = generateSingleSubjectSpread(remainingSeats, everyoneElse, seed);
    assignments.push(...restResult.assignments);
    unseated.push(...restResult.unseated);

    return { assignments, unseated, fallbackReason: 'SINGLE_SUBJECT_SPREAD' };
  }

  const accessiblePlacement = place(accessibilityRequired, accessibleSeats, input.strategy);
  assignments.push(...accessiblePlacement.placed);
  unseated.push(...accessiblePlacement.leftoverStudents);

  const usedAccessibleSeatIds = new Set(accessiblePlacement.placed.map((a) => a.seatId));
  const remainingSeats = rowMajor([
    ...accessibleSeats.filter((s) => !usedAccessibleSeatIds.has(s.id)),
    ...nonAccessibleSeats,
  ]);

  const restPlacement = place(everyoneElse, remainingSeats, input.strategy);
  assignments.push(...restPlacement.placed);
  unseated.push(...restPlacement.leftoverStudents);

  return { assignments, unseated };
}

/** SEQUENTIAL fills in roster order; the other three use the neighbour-aware mixed placement. */
function place(
  students: StudentToSeatInput[],
  seats: SeatInput[],
  strategy: SeatingStrategyName,
): { placed: SeatAssignment[]; leftoverStudents: StudentToSeatInput[] } {
  switch (strategy) {
    case 'SEQUENTIAL':
      return zip(canonicalOrder(students), seats);
    case 'ALTERNATE_SUBJECT':
      // Each quiz = one subject in this session.
      return generateMixedPlacement(seats, students, (s) => s.quizId);
    case 'ALTERNATE_BATCH':
      return generateMixedPlacement(seats, students, (s) => s.batchId);
    case 'SUBJECT_BATCH_MIX':
      return generateMixedPlacement(seats, students, (s) => `${s.subjectId}::${s.batchId}`);
    default: {
      const exhaustive: never = strategy;
      throw new Error(`Unknown seating strategy: ${String(exhaustive)}`);
    }
  }
}

function rowMajor(seats: SeatInput[]): SeatInput[] {
  return [...seats].sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
}

function zip(
  students: StudentToSeatInput[],
  seats: SeatInput[],
): { placed: SeatAssignment[]; leftoverStudents: StudentToSeatInput[] } {
  const placed: SeatAssignment[] = [];
  const count = Math.min(students.length, seats.length);
  for (let i = 0; i < count; i++) {
    placed.push({ seatId: seats[i].id, studentId: students[i].studentId, quizId: students[i].quizId });
  }
  return { placed, leftoverStudents: students.slice(count) };
}

/**
 * Deterministic base ordering shared by every strategy: (quizId,
 * studentId) ascending — this is what SEQUENTIAL uses as-is, and what
 * every other strategy starts from before regrouping/shuffling, so ties
 * within a group are always broken the same, reproducible way.
 */
function canonicalOrder(students: StudentToSeatInput[]): StudentToSeatInput[] {
  return [...students].sort(
    (a, b) => a.quizId.localeCompare(b.quizId) || a.studentId.localeCompare(b.studentId),
  );
}
