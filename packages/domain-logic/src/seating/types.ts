/**
 * Phase 13 built the first five (IMPLEMENTATION_PLAN.md: "seat map +
 * strategies ... this phase's engine work should be built as pure,
 * framework-independent functions in packages/domain-logic"). Phase 14
 * adds `ANTI_CHEATING` (ARCHITECTURE.md §U) — the NestJS DTO layer
 * (apps/api) rejected it through Phase 13; that restriction is lifted
 * now that its algorithm exists here.
 */
export type SeatingStrategyName =
  | 'SEQUENTIAL'
  | 'RANDOMIZED'
  | 'ALTERNATE_SUBJECT'
  | 'ALTERNATE_BATCH'
  | 'SUBJECT_BATCH_MIX'
  | 'ANTI_CHEATING';

export interface SeatInput {
  id: string;
  rowIndex: number;
  colIndex: number;
  isActive: boolean;
  isAccessible: boolean;
}

export interface StudentToSeatInput {
  studentId: string;
  quizId: string;
  subjectId: string;
  batchId: string;
  /**
   * BR-028 (accessibility HARD constraint). No source of truth for this
   * flag exists anywhere in the current schema (`Student` has no such
   * field) — the NestJS caller always passes `false` for every student
   * today. The parameter exists so the constraint is real and testable
   * now, not retrofitted later when a future phase adds the field.
   */
  requiresAccessibleSeat: boolean;
}

export interface SeatAssignment {
  seatId: string;
  studentId: string;
  quizId: string;
}

export interface GenerateSeatingInput {
  seats: SeatInput[];
  students: StudentToSeatInput[];
  strategy: SeatingStrategyName;
  /**
   * Deterministic seed for RANDOMIZED (e.g. `${examSessionId}:${roomId}:${version}`)
   * — same seed + same inputs ⇒ byte-identical output (reproducibility).
   * Ignored by every other strategy, which are deterministic by
   * construction and need no seed.
   */
  seed?: string;
}

/**
 * ARCHITECTURE.md §U step 6, "Single-subject fallback": when a room's
 * roster has no subject diversity to exploit at all, ANTI_CHEATING falls
 * back down this chain — "called out explicitly to the Admin ... never
 * silently." `undefined` means the room DID have subject diversity and
 * the real greedy-graph-coloring + repair algorithm ran normally.
 */
export type AntiCheatingFallbackReason =
  | 'SINGLE_SUBJECT_ALTERNATE_BATCH'
  | 'SINGLE_SUBJECT_CHECKERBOARD_SPACING'
  | 'SINGLE_SUBJECT_RANDOMIZED';

export interface GenerateSeatingResult {
  assignments: SeatAssignment[];
  /**
   * Students who could not be placed (insufficient active seats, or
   * insufficient accessible seats for those requiring one) — surfaced
   * explicitly, never silently dropped. The caller's validator turns a
   * non-empty list here into a HARD `UNSEATED_STUDENT` violation.
   */
  unseated: StudentToSeatInput[];
  /** Only ever set for `ANTI_CHEATING` when the single-subject fallback chain fired — see `AntiCheatingFallbackReason`. */
  fallbackReason?: AntiCheatingFallbackReason;
}

export type HardViolationType =
  | 'DUPLICATE_SEAT'
  | 'DUPLICATE_STUDENT'
  | 'INACTIVE_SEAT'
  | 'ACCESSIBILITY_MISMATCH'
  | 'UNSEATED_STUDENT'
  | 'UNKNOWN_SEAT'
  | 'UNKNOWN_STUDENT'
  | 'SEPARATION_VIOLATION';

export interface HardViolation {
  type: HardViolationType;
  message: string;
  seatId?: string;
  studentId?: string;
}

export type SoftViolationType = 'SUBJECT_ADJACENCY' | 'BATCH_ADJACENCY' | 'QUIZ_ADJACENCY';

export interface SoftViolation {
  type: SoftViolationType;
  message: string;
  seatIdA: string;
  seatIdB: string;
}

export interface ValidateSeatingInput {
  seats: SeatInput[];
  /** The PERSISTED assignments to validate — re-scanned from scratch, independent of whatever `generateSeating` produced (ADR-004). */
  assignments: SeatAssignment[];
  /** The full expected roster for this plan — every entry here must end up with exactly one assignment. */
  students: StudentToSeatInput[];
  /**
   * BR-029 (student-pair separation, HARD). No data source exists yet
   * (no incident-tracking table) — always `[]` from every current
   * caller; the parameter exists so the rule is real and testable, not
   * hypothetical.
   */
  separationPairs?: [string, string][];
}

export interface ValidateSeatingResult {
  hardViolations: HardViolation[];
  softViolations: SoftViolation[];
  /** 1 - (violating adjacent pairs / total occupied-adjacent pairs), clamped [0,1]; 1 when there are no adjacent occupied pairs to violate. */
  softConstraintScore: number;
}
