import { seededShuffle } from './deterministic-random';
import { generateAntiCheatingPlacement } from './anti-cheating';
import {
  AntiCheatingFallbackReason,
  GenerateSeatingInput,
  GenerateSeatingResult,
  SeatAssignment,
  SeatingStrategyName,
  SeatInput,
  StudentToSeatInput,
} from './types';

/**
 * ============================================================================
 * PHASE 13 — SEATING GENERATION (pure, framework-independent)
 * ============================================================================
 * ARCHITECTURE.md §T names five strategies (Sequential, Random,
 * Alternate-Subject, Batch Alternation, Subject+Batch Mix) but — confirmed
 * against every authoritative doc — none of them defines a concrete
 * ordering/tie-break algorithm anywhere. The definitions below are a
 * disclosed, reasonable engineering interpretation of each name,
 * documented per-strategy; they are NOT quoted from any doc. Every
 * strategy shares the same two-stage pipeline and is fully deterministic
 * given the same inputs (RANDOMIZED via `seed`, the other four by
 * construction) — this is what "reproducibility" (this phase's own
 * explicit test requirement) means in practice: same (seats, students,
 * strategy, seed) in ⇒ byte-identical assignments out, always.
 *
 * Pipeline:
 *  1. Split the roster into accessibility-required vs. everyone else
 *     (BR-028 is HARD — an accessibility-required student may ONLY land
 *     in an `isAccessible` seat, so they are placed first, into the
 *     accessible-seat pool specifically, before that pool is opened up to
 *     anyone else).
 *  2. Place the accessibility-required group into accessible ACTIVE seats
 *     (row-major order), using the SAME strategy ordering as step 3.
 *  3. Place everyone else into the remaining ACTIVE seats (accessible
 *     leftovers included) in row-major order, using the chosen strategy's
 *     student ordering.
 *  4. Anyone who still doesn't fit (either sub-population exhausts its
 *     seat pool) is returned in `unseated`, never silently dropped —
 *     `validateSeating` turns a non-empty `unseated` outcome (via a
 *     missing assignment for that student) into a HARD violation.
 *
 * Phase 14 adds `ANTI_CHEATING` (ARCHITECTURE.md §U — see anti-cheating.ts)
 * as a 6th strategy. It shares this same accessibility-first split (steps
 * 1-2 above), but needs SEAT-AWARE placement, not just a student ORDER
 * zipped against row-major seats — greedy graph-coloring has to know
 * which seats are already occupied by whom to pick the least-colliding
 * candidate for each seat. It is therefore dispatched separately, before
 * the `orderStudents`+`zip` pipeline the other five strategies share.
 */
export function generateSeating(input: GenerateSeatingInput): GenerateSeatingResult {
  const activeSeats = input.seats.filter((s) => s.isActive);
  const accessibleSeats = rowMajor(activeSeats.filter((s) => s.isAccessible));
  const nonAccessibleSeats = rowMajor(activeSeats.filter((s) => !s.isAccessible));

  const accessibilityRequired = input.students.filter((s) => s.requiresAccessibleSeat);
  const everyoneElse = input.students.filter((s) => !s.requiresAccessibleSeat);

  const assignments: SeatAssignment[] = [];
  const unseated: StudentToSeatInput[] = [];

  if (input.strategy === 'ANTI_CHEATING') {
    const accessibleResult = generateAntiCheatingPlacement(
      accessibleSeats,
      accessibilityRequired,
      `${input.seed ?? ''}:accessible`,
    );
    assignments.push(...accessibleResult.assignments);
    unseated.push(...accessibleResult.unseated);

    const usedAccessibleSeatIds = new Set(accessibleResult.assignments.map((a) => a.seatId));
    const remainingSeats = rowMajor([
      ...accessibleSeats.filter((s) => !usedAccessibleSeatIds.has(s.id)),
      ...nonAccessibleSeats,
    ]);

    const restResult = generateAntiCheatingPlacement(remainingSeats, everyoneElse, input.seed ?? '');
    assignments.push(...restResult.assignments);
    unseated.push(...restResult.unseated);

    const fallbackReason: AntiCheatingFallbackReason | undefined =
      restResult.fallbackReason ?? accessibleResult.fallbackReason;

    return { assignments, unseated, fallbackReason };
  }

  const orderedAccessibilityRequired = orderStudents(accessibilityRequired, input.strategy, `${input.seed ?? ''}:accessible`);
  const accessiblePlacement = zip(orderedAccessibilityRequired, accessibleSeats);
  assignments.push(...accessiblePlacement.placed);
  unseated.push(...accessiblePlacement.leftoverStudents);

  const usedAccessibleSeatIds = new Set(accessiblePlacement.placed.map((a) => a.seatId));
  const remainingSeats = rowMajor([
    ...accessibleSeats.filter((s) => !usedAccessibleSeatIds.has(s.id)),
    ...nonAccessibleSeats,
  ]);

  const orderedEveryoneElse = orderStudents(everyoneElse, input.strategy, input.seed ?? '');
  const restPlacement = zip(orderedEveryoneElse, remainingSeats);
  assignments.push(...restPlacement.placed);
  unseated.push(...restPlacement.leftoverStudents);

  return { assignments, unseated };
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

/** `ANTI_CHEATING` is intercepted in `generateSeating` before this is ever called — excluded here so the exhaustiveness check below stays meaningful for the other five. */
function orderStudents(
  students: StudentToSeatInput[],
  strategy: Exclude<SeatingStrategyName, 'ANTI_CHEATING'>,
  seed: string,
): StudentToSeatInput[] {
  const canonical = canonicalOrder(students);

  switch (strategy) {
    case 'SEQUENTIAL':
      // Fills the room in reading order, one quiz-block after another —
      // the simplest baseline, no adjacency-avoidance attempted.
      return canonical;

    case 'RANDOMIZED':
      // A deterministically-seeded shuffle of the canonical order —
      // "random" to a human, byte-identical on every regeneration with
      // the same seed (reproducibility).
      return seededShuffle(canonical, seed);

    case 'ALTERNATE_SUBJECT':
      // Round-robin across quizzes (each quiz = one subject in this
      // session) so consecutive seat placements alternate subjects as
      // much as the group sizes allow — directly targets the SOFT
      // "adjacent seats prefer different subject" objective (§V).
      return roundRobin(canonical, (s) => s.quizId);

    case 'ALTERNATE_BATCH':
      // Same round-robin idea, grouped by batch instead of subject —
      // targets the SOFT "adjacent seats prefer different batch"
      // objective.
      return roundRobin(canonical, (s) => s.batchId);

    case 'SUBJECT_BATCH_MIX':
      // Round-robin over the composite (subject, batch) key — spreads
      // out both dimensions at once, a middle ground between the two
      // single-dimension alternation strategies above.
      return roundRobin(canonical, (s) => `${s.subjectId}::${s.batchId}`);

    default: {
      const exhaustive: never = strategy;
      throw new Error(`Unknown seating strategy: ${String(exhaustive)}`);
    }
  }
}

/**
 * Groups `students` by `keyOf` (each group internally in canonical
 * order), then interleaves one student from each group in turn — group
 * order itself is the groups' first-seen order in `students` (which is
 * already canonically sorted, so this is deterministic) — cycling until
 * every group is exhausted.
 */
function roundRobin(
  students: StudentToSeatInput[],
  keyOf: (s: StudentToSeatInput) => string,
): StudentToSeatInput[] {
  const groups = new Map<string, StudentToSeatInput[]>();
  for (const student of students) {
    const key = keyOf(student);
    const group = groups.get(key);
    if (group) {
      group.push(student);
    } else {
      groups.set(key, [student]);
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
