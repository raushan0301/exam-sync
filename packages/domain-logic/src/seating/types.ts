/**
 * The four supported strategies. Sequential fills in roster order; the other three round-robin by
 * subject, by batch, or by both so neighbouring seats differ.
 */
export type SeatingStrategyName = 'SEQUENTIAL' | 'ALTERNATE_SUBJECT' | 'ALTERNATE_BATCH' | 'SUBJECT_BATCH_MIX';

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
  /** Roll number (any format, compared "naturally": R2 < R10). Optional — used only to keep consecutive roll numbers apart. */
  rollNumber?: string;
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
   * Seed for the roll-number spread's tie-breaking — same seed + same inputs ⇒ identical output.
   */
  seed?: string;
  /**
   * Leave every second COLUMN of the room empty (columns 1st, 3rd, 5th... are used) so no student has a
   * side neighbour. Capacity permitting — students that no longer fit come back in `unseated`.
   */
  skipAlternateColumns?: boolean;
}

/**
 * Set when a mixing strategy had nothing to mix in this room (one subject, or one batch) and the
 * roll-number / batch / staggered-row spread was used instead — told to the caller, never silent.
 */
export type SeatingFallbackReason = 'SINGLE_SUBJECT_SPREAD';

export interface GenerateSeatingResult {
  assignments: SeatAssignment[];
  /**
   * Students who could not be placed (insufficient active seats, or
   * insufficient accessible seats for those requiring one) — surfaced
   * explicitly, never silently dropped. The caller's validator turns a
   * non-empty list here into a HARD `UNSEATED_STUDENT` violation.
   */
  unseated: StudentToSeatInput[];
  /** Only set when the spread replaced a mixing strategy — see `SeatingFallbackReason`. */
  fallbackReason?: SeatingFallbackReason;
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

export type SoftViolationType = 'SUBJECT_ADJACENCY' | 'BATCH_ADJACENCY' | 'QUIZ_ADJACENCY' | 'ROLL_ADJACENCY';

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
