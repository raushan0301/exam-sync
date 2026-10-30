/**
 * Minimal local interfaces for M3 dashboard data — deliberately only the
 * fields these dashboards actually consume, not a full domain model.
 * apps/web has no clean import path into @exam-sync/db's Prisma types, so
 * these are hand-typed against the real API_CONTRACT.md / controller
 * response shapes (verified against apps/api/src source directly).
 */

export interface PaginatedResult<T> {
  items: T[];
  next_cursor: string | null;
}

export type QuizStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/**
 * Matches ARCHITECTURE.md §AC's literal `quizzes` column list, verified
 * directly against packages/db/prisma/schema.prisma's `Quiz` model and
 * quizzes.service.ts's actual Prisma return shape (camelCase, no @map
 * translation applied to the JSON response). Every field from
 * `durationMinutes` down is nullable on a DRAFT — a quiz only becomes
 * "complete" once `POST /quizzes/{id}/submit` succeeds.
 */
export interface Quiz {
  id: string;
  title: string;
  subjectId: string;
  createdByFacultyId: string;
  durationMinutes: number | null;
  studentCount: number | null;
  instructions: string | null;
  quizType: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  academicYear: string;
  semester: number;
  status: QuizStatus;
  /** Faculty's preliminary room request (RoomSuggestionService.suggestForQuiz), shown to admin as a conflict preview during approval. */
  requestedRoomIds: string[];
  backupRoomId: string | null;
  /** Lock the backup room's seats too once the quiz is approved (the faculty picks; the admin may change it at approval). */
  backupRoomLocked?: boolean;
  /** Answer to "leave every second seat column empty?" given when rooms were requested; null = not asked. */
  emptyColumnsPlanned?: boolean | null;
  roomAllocationStrategy: string | null;
  /** Set when an ADMIN adjusts this room request (swap, backup removed) while reviewing — shown back to the faculty. Cleared on the faculty's own next request. */
  roomAdjustmentNote: string | null;
  /** Optimistic-lock version (BR-051) — required as `If-Match` on PATCH/approve. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Only present on `GET /quizzes` (list) rows, not `GET /quizzes/{id}` —
   * the exam session this quiz is CURRENTLY actively attached to, if any.
   * `null`/absent means not yet scheduled (or its attachment was detached).
   */
  examSession?: { id: string; status: ExamSessionStatus } | null;
}

/** A room actually booked for the exam session a quiz was attached to (exam_session_rooms) — the FINAL allocation, distinct from `Quiz.requestedRoomIds`'s preliminary recommendation. */
export interface QuizAllocatedRoom {
  id: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  allocatedCapacity: number;
}

/** Seats held for an approved quiz until its rooms are allocated to a session. */
export interface QuizRoomHold {
  roomId: string;
  kind: 'MAIN' | 'BACKUP';
  seatsHeld: number;
  holdDate: string;
  startTime: string;
  endTime: string;
}

/** GET /quizzes/{id} response shape — same fields as Quiz, plus the active exam session (with its finally-allocated rooms, once any exist) and the seats held for it. */
export interface QuizDetail extends Quiz {
  /** Active holds only — empty once the rooms are allocated, released, or the window has passed. */
  roomHolds?: QuizRoomHold[];
  examSession: { id: string; status: ExamSessionStatus; rooms: QuizAllocatedRoom[] } | null;
}

export type QuizApprovalAction = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RESUBMITTED';

/**
 * Matches ARCHITECTURE.md §L's literal `quiz_approval_history` column
 * list, verified against the `QuizApprovalHistory` Prisma model. Append-
 * only ledger — no update/delete path anywhere in the app.
 */
export interface QuizApprovalHistoryEntry {
  id: string;
  quizId: string;
  action: QuizApprovalAction;
  actorId: string;
  reason: string | null;
  previousStatus: QuizStatus;
  newStatus: QuizStatus;
  createdAt: string;
}

export type IncidentStatus = 'OPEN' | 'UNDER_REVIEW' | 'ESCALATED' | 'RESOLVED' | 'DISMISSED';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type IncidentType =
  | 'CHEATING_SUSPICION'
  | 'UNAUTHORIZED_MATERIAL'
  | 'MISCONDUCT'
  | 'MISSING'
  | 'LATE'
  | 'MEDICAL'
  | 'SEATING'
  | 'TECHNICAL'
  | 'ROOM'
  | 'IDENTITY'
  | 'PAPER'
  | 'OTHER';

/** CREATE is server-internal only — never sent/offered from any client action. */
export type IncidentAction = 'INVESTIGATE' | 'ESCALATE' | 'RESOLVE' | 'DISMISS';

export interface Incident {
  id: string;
  incidentType: IncidentType | string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  examSessionId: string;
  quizId?: string | null;
  studentId?: string | null;
  roomId?: string | null;
  seatId?: string | null;
  description: string;
  resolution?: string | null;
  notes?: string | null;
  evidenceMetadata?: Record<string, unknown> | null;
  createdAt: string;
  /** Resolved display labels for the FK ids above — see IncidentsService.list's own comment for why; render these, never the raw *Id fields. */
  examSessionName: string;
  roomLabel: string | null;
  studentLabel: string | null;
  quizTitle: string | null;
}

/**
 * `GET /incidents/{id}/history` row (ADMIN only) — verified against the
 * Prisma `IncidentHistory` model: one row per transition, INCLUDING the
 * initial CREATE→OPEN row (BR-039), ordered by createdAt asc.
 */
export interface IncidentHistoryEntry {
  id: string;
  incidentId: string;
  action: 'CREATE' | IncidentAction;
  actorId: string;
  previousStatus: IncidentStatus | null;
  newStatus: IncidentStatus;
  resolution: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * `readAt` is the real "is this read?" field on the Prisma `Notification`
 * model (nullable DateTime, set by `PATCH /me/notifications/{id}/read`) —
 * verified in packages/db/prisma/schema.prisma. `status` on that model is
 * unrelated: it's the outbox DELIVERY status (PENDING/RETRYING/SENT/
 * DEAD_LETTER), not a read/unread flag, so it is intentionally not used
 * here for "unread" logic.
 */
// -- Academic Structure + People (Milestone 4) -------------------------
// Field names are camelCase to match Prisma's default @map-free response
// shape, verified directly against apps/api/src's services (e.g.
// departments.service.ts returns the raw Prisma `Department` row).

export type AcademicStatus = 'ACTIVE' | 'INACTIVE';

export interface Department {
  id: string;
  name: string;
  code: string;
  status: AcademicStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Program {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  status: AcademicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  programId: string;
  year: string;
  section: string;
  subsection: string;
  status: AcademicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  id: string;
  departmentId: string;
  programId: string | null;
  code: string;
  name: string;
  credits: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  userId: string;
  name: string;
  programId: string;
  batchId: string;
  rollNumber: string;
  status: AcademicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Faculty {
  id: string;
  userId: string;
  name: string;
  departmentId: string;
  employeeCode: string;
  status: AcademicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowResult {
  row: number;
  status: 'SUCCESS' | 'FAILURE';
  id?: string;
  error?: string;
}

export interface ImportJob {
  id: string;
  resourceType: string;
  status: 'COMPLETED' | 'FAILED';
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: ImportRowResult[];
  createdByUserId: string;
  createdAt: string;
}

// -- Exam Sessions (Milestone 6) ----------------------------------------
// Verified directly against apps/api/src/modules/exam-session/*.ts and
// packages/db/prisma/schema.prisma's `ExamSession` model. Field names are
// camelCase (no @map translation applied to the JSON response), same
// convention as Quiz above. `GET /exam-sessions` (list, paginated) was
// ADDED by the faculty-lifecycle-ownership change — ADMIN sees every
// session unscoped, FACULTY sees only sessions they own/co-instruct.

export type ExamSessionStatus =
  | 'DRAFT'
  | 'ASSIGNING_STUDENTS'
  | 'ROOM_ALLOCATION'
  | 'SEATING_GENERATION'
  | 'READY_FOR_FINALIZATION'
  | 'FINALIZED'
  | 'NOTIFIED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Matches `packages/db/prisma/schema.prisma`'s `ExamSession` model
 * (camelCase, no @map translation on the JSON response — verified against
 * exam-sessions.service.ts's raw Prisma return shape). `version` exists
 * for optimistic-locking parity with Quiz, but — verified against
 * exam-sessions.controller.ts / exam-sessions.service.ts — none of the
 * PATCH/POST endpoints here (quizzes, reschedule, cancel) read an
 * `If-Match` header; the server increments `version` itself on every
 * write. So `If-Match` is NOT sent by any exam-session mutation below.
 */
export interface ExamSession {
  id: string;
  name: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  status: ExamSessionStatus;
  createdByAdminId: string;
  /** Faculty's requested candidate rooms while status is ROOM_ALLOCATION (pending admin review). */
  requestedRoomIds: string[];
  backupRoomId: string | null;
  roomAllocationStrategy: string | null;
  /** Set when an admin sends a room request back for changes; cleared on the next request/allocate. */
  roomRejectionReason: string | null;
  /** The "leave every second seat column empty?" answer given with the room request — pre-selected at seating time; null = not asked. */
  emptyColumnsPlanned?: boolean | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /exam-sessions/{id}` response shape — verified against
 * `ExamSessionsService.getDetail`: the plain session row plus `quizzes`
 * (full `Quiz` rows via the active `exam_session_quizzes` join) and
 * `rooms` (full `Room` rows plus `allocatedCapacity` from the
 * `exam_session_rooms` join).
 */
export interface ExamSessionRoom {
  id: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  rows: number;
  columns: number;
  status: string;
  allocatedCapacity: number;
}

export interface ExamSessionDetail extends ExamSession {
  quizzes: Quiz[];
  rooms: ExamSessionRoom[];
  backupRoom: ExamSessionRoom | null;
  /** True once every allocated room has a VALIDATED/FINALIZED seating plan — the real `status` enum can't express "seating done, just waiting on invigilators" (SEATING_GENERATION covers both), so the progress stepper uses this to show "Seating Generation" as complete and "Assign Invigilator" as the actual next step. */
  seatingReady: boolean;
}

/**
 * Verbatim from apps/api/src/modules/conflict-engine/conflict-engine.types.ts
 * — reproduced field-for-field, including which fields are set for which
 * conflict `type` per that file's own doc comments.
 */
export interface ConflictDetail {
  type:
    | 'UNAPPROVED_QUIZ'
    | 'QUIZ_ALREADY_ATTACHED_ELSEWHERE'
    | 'STUDENT_OVERLAP'
    | 'ROOM_OVERLAP'
    | 'ROOM_UNAVAILABLE'
    | 'FACULTY_OVERLAP';
  quizId?: string;
  /** Set for STUDENT_OVERLAP (BR-019) — the student with the conflicting assignment. */
  studentId?: string;
  /** Set for ROOM_OVERLAP/ROOM_UNAVAILABLE (BR-018/BR-022) — the candidate room this conflict is about. */
  roomId?: string;
  /** Set for FACULTY_OVERLAP (BR-020/BR-031) — the faculty member with the conflicting invigilation assignment. */
  facultyId?: string;
  /** Set for STUDENT_OVERLAP/ROOM_OVERLAP/FACULTY_OVERLAP — the other exam session already holding the conflicting claim. */
  conflictingExamSessionId?: string;
  message: string;
}

export interface ConflictCheckResult {
  hard: ConflictDetail[];
  warnings: ConflictDetail[];
}

/** Another approved quiz's seats held in a room at an overlapping time — the room is shared, not full. */
export interface SharedHold {
  quizId: string;
  quizTitle: string;
  seats: number;
}

/** GET /exam-sessions/{id}/rooms/suggest — RoomSuggestionService's per-strategy room preview. */
export interface SuggestedRoom {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  /** Seats free for this request — seats other quizzes hold are already left out. */
  capacity: number;
  allocated: number;
  sharedWith?: SharedHold[];
}

/** SEQUENTIAL was retired; a request saved earlier may still carry it, so labels handle it, but it is never offered. */
export type RoomSuggestionStrategy = 'FEWEST_ROOMS' | 'BALANCED_SPREAD';

export interface RoomSuggestionAlternative {
  label: string;
  description: string;
  roomCount: number;
  totalCapacity: number;
  utilizationPercent: number;
  rooms: SuggestedRoom[];
  /** "Building B · floors 0–1" */
  location: string;
  spansBuildings: boolean;
}

export interface RoomSuggestionResult {
  strategy: RoomSuggestionStrategy;
  label: string;
  description: string;
  roomCount: number;
  totalCapacity: number;
  utilizationPercent: number;
  rooms: SuggestedRoom[];
  /** Where these rooms are — "Building B · floors 0–1". Default plan: one building if it fits, floor by floor from the ground up. */
  location: string;
  spansBuildings: boolean;
  /** Present only when fewer rooms are possible by giving up "stay together" — the person is asked which they prefer. */
  alternative?: RoomSuggestionAlternative;
}

export interface AvailableRoomOption {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  sharedWith?: SharedHold[];
}

export interface RoomSuggestionResponse {
  totalStudents: number;
  /** True when room sizes count only usable seats (every second column left empty). */
  emptyColumns: boolean;
  shortfall: boolean;
  availableRoomCount: number;
  strategies: RoomSuggestionResult[];
  /** Every available room for this date/time, not just the ones a strategy picked — for a manual "pick any room" dropdown. */
  allRooms: AvailableRoomOption[];
}

/** GET /exam-sessions/{id}/rooms/preview — live availability for the admin review screen. */
export interface RoomAvailabilityRow {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  available: boolean;
  reason?: string;
  /** Other approved quizzes already holding seats in this room at this time. */
  sharedWith?: SharedHold[];
  alternatives?: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[];
}

export interface StudentScheduleConflict {
  studentId: string;
  conflictingExamSessionId: string;
  message: string;
}

export interface RoomAvailabilityPreview {
  requestedRooms: RoomAvailabilityRow[];
  backupRoom: RoomAvailabilityRow | null;
  strategy: string | null;
  /** Quiz-stage only — eligible students already booked elsewhere at an overlapping time (BR-019), checked against the quiz's own preferred slot so this shows up before approval. Always [] at the exam-session stage. */
  studentConflicts: StudentScheduleConflict[];
}

// -- Rooms / Room Allocation / Student Assignment / Faculty Assignments
// (Milestone 7) --------------------------------------------------------
// Verified directly against packages/db/prisma/schema.prisma's Room,
// RoomSeat, RoomAvailability, QuizStudentAssignment, and
// FacultySubjectBatchAssignment models, and the corresponding
// controllers/services under apps/api/src/modules/{rooms,room-allocation,
// student-assignment,faculty-assignment}. camelCase, no @map translation
// applied to the JSON response — same convention as every model above.

export type RoomStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

/**
 * `GET /rooms/availability?date=...` response entry — added for the
 * faculty-lifecycle-ownership change's room-availability calendar.
 * Verified against `RoomsService.getAvailabilityCalendar`'s return shape.
 */
export interface RoomBookedRange {
  start_time: string;
  end_time: string;
  source: 'EXAM_SESSION' | 'AVAILABILITY_BLOCK' | 'SEAT_HOLD';
  exam_session_id?: string;
  exam_session_name?: string;
  reason?: string | null;
  /** SEAT_HOLD only: seats approved quizzes keep free in this slot, and which quizzes. */
  seats_held?: number;
  quiz_titles?: string[];
}

export interface RoomAvailabilityCalendarEntry {
  room: Room;
  bookedRanges: RoomBookedRange[];
}

/** `rooms` — verified against rooms.service.ts's raw Prisma return shape. */
export interface Room {
  id: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  rows: number;
  columns: number;
  status: RoomStatus;
  accessibilityInfo: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `room_seats` — field names verified against rooms.service.ts's
 * `listSeats`/`updateSeat` (`rowIndex`, `colIndex`, `isAccessible`,
 * `isActive`, `seatLabel`).
 */
export interface RoomSeat {
  id: string;
  roomId: string;
  seatLabel: string;
  rowIndex: number;
  colIndex: number;
  isAccessible: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `room_availability` — a blackout window, no update/delete endpoint exists. */
export interface AvailabilityBlock {
  id: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  createdAt: string;
}

export type QuizStudentAssignmentStatus = 'ASSIGNED' | 'WAITLISTED' | 'CANCELLED';

/**
 * `quiz_student_assignments` — the roster row returned raw by
 * `GET /exam-sessions/{id}/roster` (student-assignment.service.ts's
 * `getRoster`), no joined student name/roll-number — callers join against
 * `useStudents`' cache/list themselves.
 */
export interface RosterEntry {
  id: string;
  quizId: string;
  examSessionId: string;
  studentId: string;
  status: QuizStudentAssignmentStatus;
  assignedAt: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Resolved off this row's own quiz/student relations — stays correct even after the quiz is detached (e.g. session cancellation), unlike cross-referencing the exam session's current `quizzes` list. */
  quizTitle: string;
  studentName: string;
  studentRollNumber: string;
}

/** Immediate (synchronous, despite the `202`) result of `POST /exam-sessions/{id}/assign-students`. */
export interface AssignStudentsResult {
  job_id: string;
  status: string;
  total_rows: number;
  success_count: number;
  failure_count: number;
  exam_session: ExamSession;
}

export type FacultyAssignmentRole = 'PRIMARY_INSTRUCTOR' | 'CO_INSTRUCTOR';

/**
 * `faculty_subject_batch_assignment` — `endedAt` is the soft-end marker
 * (DELETE sets it, never hard-deletes); active iff `endedAt === null`.
 */
export interface FacultyAssignment {
  id: string;
  facultyId: string;
  subjectId: string;
  batchId: string;
  academicYear: string;
  semester: number;
  role: FacultyAssignmentRole;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

/** `student_subject_enrollment` — `status` defaults to ENROLLED; `droppedAt` is set, never hard-deleted, on a drop. */
export interface StudentSubjectEnrollment {
  id: string;
  studentId: string;
  subjectId: string;
  batchId: string;
  academicYear: string;
  semester: number;
  status: 'ENROLLED' | 'DROPPED';
  enrolledAt: string;
  droppedAt: string | null;
}

// -- Seating (Milestone 8) -----------------------------------------------
// Verified directly against packages/db/prisma/schema.prisma's
// `SeatingPlanStatus`/`SeatingStrategy` enums and `SeatingPlan`/
// `SeatingAssignment` models, and
// apps/api/src/modules/seating-engine/seating-engine.{controller,service}.ts
// — camelCase, no @map translation applied to the JSON response, same
// convention as every model above. There is deliberately NO swap/manual
// reassignment endpoint (the controller's own header comment discloses
// this as a deferral, not an oversight) — nothing here models one.

/** Strategies a new plan can use. */
export type SeatingStrategyName = 'SEQUENTIAL' | 'ALTERNATE_SUBJECT' | 'ALTERNATE_BATCH' | 'SUBJECT_BATCH_MIX';

/** A stored plan may be from before RANDOMIZED / ANTI_CHEATING were removed. */
export type StoredSeatingStrategyName = SeatingStrategyName | 'RANDOMIZED' | 'ANTI_CHEATING';

export type SeatingPlanStatus = 'DRAFT' | 'VALIDATED' | 'FAILED' | 'FINALIZED' | 'SUPERSEDED';

/**
 * Immediate (synchronous, despite the `202`) result of
 * `POST /exam-sessions/{id}/seating/generate`, and also the exact shape of
 * `GET /seating-jobs/{id}` — verified against
 * `SeatingEngineService.toSummary`/`toSummaryWithViolations`.
 * `hard_violations` is only populated when `status === 'FAILED'`;
 * `soft_violations` only when `status === 'VALIDATED'`. `fallback_reason` is
 * present only when the one-subject roll-number spread replaced the strategy.
 */
export interface SeatingGenerationSummary {
  job_id: string;
  seating_plan_id: string;
  status: SeatingPlanStatus;
  soft_constraint_score: number | null;
  hard_violations: unknown[];
  soft_violations: unknown[];
  fallback_reason?: string;
}

/** `seating_assignments` row plus the `seat`/`student`/`quiz` joins `findByIdScoped` includes. */
export interface SeatingAssignment {
  id: string;
  seatingPlanId: string;
  studentId: string;
  quizId: string;
  seatId: string;
  createdAt: string;
  seat: RoomSeat;
  student: Student;
  quiz: Pick<Quiz, 'id' | 'title'>;
}

/** `GET /seating-plans/{id}` response — the `seating_plans` row plus its `assignments`. */
export interface SeatingPlan {
  id: string;
  examSessionId: string;
  roomId: string;
  strategy: StoredSeatingStrategyName;
  status: SeatingPlanStatus;
  softConstraintScore: number | null;
  violationReport: unknown[] | null;
  version: number;
  generatedAt: string;
  finalizedAt: string | null;
  assignments: SeatingAssignment[];
}

// -- Invigilation + Attendance (Milestone 9) -----------------------------
// Verified directly against apps/api/src/modules/invigilation/*.ts and
// apps/api/src/modules/attendance/*.ts, and packages/db/prisma/schema.prisma's
// `ExamInvigilator`/`Attendance`/`AttendanceHistory` models + `InvigilatorRole`/
// `AttendanceStatus`/`AttendanceMethod` enums. camelCase, no @map translation
// applied to the JSON response — same convention as every model above.

export type InvigilatorRole = 'LEAD_INVIGILATOR' | 'ASSISTANT_INVIGILATOR';

/** `exam_invigilators` row — verified against invigilation.service.ts's raw Prisma return shape. */
export interface Invigilator {
  id: string;
  examSessionId: string;
  roomId: string;
  facultyId: string;
  role: InvigilatorRole;
  assignedAt: string;
  createdAt: string;
}

/**
 * `GET /faculty/{id}/invigilation-duties` response shape only — carries
 * the session name/schedule and room label alongside the base
 * `Invigilator` fields, since an invigilator on someone ELSE's session
 * can't call `GET /exam-sessions/{id}` themselves to look these up.
 */
export interface InvigilatorDuty extends Invigilator {
  examSession: { name: string; sessionDate: string; startTime: string; endTime: string; status: ExamSessionStatus };
  room: { building: string; roomNumber: string };
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'MEDICAL' | 'OTHER';

/**
 * DTO restricts to MANUAL/SEAT_BASED only (QR/BIOMETRIC are pre-sized on
 * the schema but confirmed to have no capture flow — never offered as a
 * method option in any UI here).
 */
export type AttendanceMethod = 'MANUAL' | 'SEAT_BASED';

/** `attendance` row — verified against attendance.service.ts's raw Prisma return shape. */
export interface Attendance {
  id: string;
  quizStudentAssignmentId: string;
  seatId: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  markedByFacultyId: string;
  markedAt: string;
  /** Flips to `true` when the owning exam session transitions to COMPLETED (BR-034); once true, PATCH requires a `reason` (BR-035, 423). */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /exam-sessions/{id}/attendance` response shape only — carries the
 * student name/roll number, quiz title, and seat label alongside the base
 * `Attendance` fields, since the raw row only has ids.
 */
export interface AttendanceOverviewRow extends Attendance {
  quizStudentAssignment: { student: { name: string; rollNumber: string }; quiz: { title: string } };
  seat: { seatLabel: string };
}

/** `attendance_history` row — appended by every PATCH /attendance/{id} that actually changes `status`. */
export interface AttendanceHistoryEntry {
  id: string;
  attendanceId: string;
  changedByFacultyId: string;
  oldStatus: AttendanceStatus;
  newStatus: AttendanceStatus;
  reason: string | null;
  changedAt: string;
}

/** `GET /students/{id}/attendance-history` response row shape — the plain Attendance row plus its ordered `history`. */
export type AttendanceWithHistory = Attendance & { history: AttendanceHistoryEntry[] };

export interface Notification {
  id: string;
  eventType: string;
  channel: string;
  payload: Record<string, unknown>;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

// -- Exam session suspension requests --------------------------------------
// Verified against apps/api/src/modules/exam-session/exam-session-suspension.service.ts
// (`SuspensionRequestView`). Approving a request cancels the session (History,
// status CANCELLED); rejecting leaves it untouched.
export type SuspensionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SuspensionRequest {
  id: string;
  examSessionId: string;
  requestedByFacultyId: string;
  /** The faculty's written justification. */
  reason: string;
  status: SuspensionRequestStatus;
  reviewedByAdminId: string | null;
  /** Admin's note — required when rejecting, optional when approving. */
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  examSessionName: string;
  examSessionDate: string;
  examSessionStartTime: string;
  examSessionEndTime: string;
  examSessionStatus: string;
  facultyName: string;
  facultyEmployeeCode: string;
}

// -- Reports (Milestone 11) ----------------------------------------------
// Verified directly against packages/db/prisma/schema.prisma's `ReportJob`
// model + `ReportType`/`ReportFormat`/`ReportJobStatus` enums, and
// apps/api/src/modules/reporting/reports.controller.ts. `GET /report-jobs/{id}`
// returns a SHAPED subset (job_id/status/download_url/error_message), not
// the raw Prisma row — reproduced verbatim here, not invented.

export type ReportType = 'ATTENDANCE' | 'SEATING_PLAN' | 'INCIDENT_REPORT' | 'ROOM_UTILIZATION';
export type ReportFormat = 'CSV' | 'EXCEL';
export type ReportJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** `POST /reports/{type}` response (202) — verified against `asJobResponse` in reports.controller.ts. */
export interface CreateReportJobResult {
  job_id: string;
}

/** `GET /report-jobs/{id}` response — verified against `ReportsController.getJob`. */
export interface ReportJob {
  job_id: string;
  status: ReportJobStatus;
  download_url: string | null;
  error_message: string | null;
}

// -- Audit Log (Milestone 11) ---------------------------------------------
// Verified directly against packages/db/prisma/schema.prisma's `AuditLog`
// model + `AuditAction` enum (CREATE/UPDATE/DEACTIVATE/REACTIVATE — no
// DELETE, confirmed by reading the real enum), and
// apps/api/src/modules/audit/audit-logs.{controller,service}.ts. camelCase,
// no @map translation applied to the JSON response — same convention as
// every other model in this file. `academicYear` is a nullable Int on the
// schema (not a string like Quiz/FacultyAssignment's academicYear).

export type AuditAction = 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE';

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  academicYear: number | null;
  createdAt: string;
}


// -- "Request more rooms" during seating ----------------------------------

export type RoomRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type RoomRequestTrigger = 'TOO_MANY_STUDENTS' | 'NO_ROOM_FOR_EMPTY_COLUMNS' | 'OTHER';

export interface RequestedRoomView {
  roomId: string;
  label: string;
  capacity: number;
  /** Seats still free for this session in the exam window. */
  freeSeats: number;
  available: boolean;
  reason?: string;
}

export interface SessionRoomView {
  roomId: string;
  label: string;
  allocated: number;
  /** Seating finalized — students were told their seats, so this room is never touched by a re-split. */
  finalized: boolean;
}

export interface RoomRequest {
  id: string;
  examSessionId: string;
  requestedByFacultyId: string;
  reason: string;
  trigger: RoomRequestTrigger;
  status: RoomRequestStatus;
  previousStatus: ExamSessionStatus;
  emptyColumns: boolean | null;
  requestedRoomIds: string[];
  approvedRoomIds: string[];
  reviewedByAdminId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  examSessionName: string;
  examSessionDate: string;
  examSessionStartTime: string;
  examSessionEndTime: string;
  examSessionStatus: string;
  facultyName: string;
  facultyEmployeeCode: string;
  requestedRooms: RequestedRoomView[];
  approvedRoomLabels: string[];
  currentRooms: SessionRoomView[];
  studentsToPlace: number;
}

/** `GET /room-requests/{id}` — the request plus the free rooms an admin could swap in. */
export interface RoomRequestDetail extends RoomRequest {
  options: AvailableRoomOption[];
}

/** `GET /exam-sessions/{id}/rooms/extra` — everything the "Request more rooms" dialog needs. */
export interface ExtraRoomsState {
  canRequest: boolean;
  blockedReason: string | null;
  pending: RoomRequest | null;
  latestRejected: RoomRequest | null;
  studentsToPlace: number;
  fullSeats: number;
  usableSeats: number;
  emptyColumns: boolean;
  seatsNeeded: number;
  trigger: RoomRequestTrigger;
  rooms: SessionRoomView[];
  suggestion: { rooms: SuggestedRoom[]; location: string; spansBuildings: boolean };
  allRooms: AvailableRoomOption[];
}
