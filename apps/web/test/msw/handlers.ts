import { http, HttpResponse } from 'msw';

export const API_BASE_URL = 'http://localhost:3000';

export interface MockUser {
  id: string;
  email: string;
  isActive: boolean;
  roles: string[];
  mustChangePassword: boolean;
  createdAt: string;
}

export const ADMIN_USER: MockUser = {
  id: 'u-admin',
  email: 'admin@exam-sync.test',
  isActive: true,
  roles: ['ADMIN'],
  mustChangePassword: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const FACULTY_USER: MockUser = {
  id: 'u-faculty',
  email: 'faculty@exam-sync.test',
  isActive: true,
  roles: ['FACULTY'],
  mustChangePassword: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const STUDENT_USER: MockUser = {
  id: 'u-student',
  email: 'student@exam-sync.test',
  isActive: true,
  roles: ['STUDENT'],
  mustChangePassword: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

// Login credentials recognized by POST /auth/login.
const CREDENTIALS: Record<string, { password: string; user: MockUser }> = {
  'admin@exam-sync.test': { password: 'correct-password', user: ADMIN_USER },
  'faculty@exam-sync.test': { password: 'correct-password', user: FACULTY_USER },
  'student@exam-sync.test': { password: 'correct-password', user: STUDENT_USER },
  // legacy fixture emails, kept for compatibility with earlier test variants
  'admin@example.com': { password: 'password1', user: ADMIN_USER },
  'faculty@example.com': { password: 'password1', user: FACULTY_USER },
  'student@example.com': { password: 'password1', user: STUDENT_USER },
};

// Fixed, pre-registered tokens usable by tests without going through login first.
export const VALID_ACCESS_TOKEN = 'valid-access-token';
export const VALID_REFRESH_TOKEN = 'valid-refresh-token';
export const ROTATED_ACCESS_TOKEN = 'rotated-access-token';
export const ROTATED_REFRESH_TOKEN = 'rotated-refresh-token';
export const STUDENT_ACCESS_TOKEN = 'student-access-token';
export const STUDENT_REFRESH_TOKEN = 'student-refresh-token';

// token -> user, for GET /users/me lookups. Seeded with fixed fixtures;
// login/refresh add dynamically-issued tokens at runtime.
export const SESSION_TOKENS: Record<string, MockUser> = {
  [VALID_ACCESS_TOKEN]: ADMIN_USER,
  [ROTATED_ACCESS_TOKEN]: ADMIN_USER,
  [STUDENT_ACCESS_TOKEN]: STUDENT_USER,
};

// refresh_token -> user, for the default POST /auth/refresh handler.
const REFRESH_TOKENS: Record<string, MockUser> = {
  [VALID_REFRESH_TOKEN]: ADMIN_USER,
  [ROTATED_REFRESH_TOKEN]: ADMIN_USER,
  [STUDENT_REFRESH_TOKEN]: STUDENT_USER,
};

export let refreshCallCount = 0;
export function resetRefreshCallCount() {
  refreshCallCount = 0;
}

function issueTokenPair(user: MockUser) {
  const access = `access-${user.id}-${Math.random().toString(36).slice(2)}`;
  const refresh = `refresh-${user.id}-${Math.random().toString(36).slice(2)}`;
  SESSION_TOKENS[access] = user;
  REFRESH_TOKENS[refresh] = user;
  return { access_token: access, refresh_token: refresh, expires_in: 900 };
}

// -- M3 dashboard fixtures --------------------------------------------------

export interface MockQuiz {
  id: string;
  title: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  subjectId: string;
  createdByFacultyId: string;
  durationMinutes?: number | null;
  studentCount?: number | null;
  instructions?: string | null;
  quizType?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  academicYear: string;
  semester: number;
  requestedRoomIds?: string[];
  backupRoomId?: string | null;
  roomAllocationStrategy?: string | null;
  roomAdjustmentNote?: string | null;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MockQuizApprovalHistoryEntry {
  id: string;
  quizId: string;
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RESUBMITTED';
  actorId: string;
  reason: string | null;
  previousStatus: MockQuiz['status'];
  newStatus: MockQuiz['status'];
  createdAt: string;
}

export interface MockIncident {
  id: string;
  incidentType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'UNDER_REVIEW' | 'ESCALATED' | 'RESOLVED' | 'DISMISSED';
  examSessionId: string;
  quizId?: string | null;
  studentId?: string | null;
  roomId?: string | null;
  seatId?: string | null;
  description: string;
  resolution?: string | null;
  notes?: string | null;
  reporterId?: string;
  createdAt: string;
}

export interface MockIncidentHistoryEntry {
  id: string;
  incidentId: string;
  action: 'CREATE' | 'INVESTIGATE' | 'ESCALATE' | 'RESOLVE' | 'DISMISS';
  actorId: string;
  previousStatus: MockIncident['status'] | null;
  newStatus: MockIncident['status'];
  resolution: string | null;
  notes: string | null;
  createdAt: string;
}

// Faculty ids (or userIds) that are treated as "not an invigilator" for
// POST /incidents' BR-037 authorization 403 test scenario.
export let INCIDENT_NOT_INVIGILATOR = false;
export function setIncidentNotInvigilator(value: boolean) {
  INCIDENT_NOT_INVIGILATOR = value;
}

export let INCIDENT_HISTORY: MockIncidentHistoryEntry[] = [];
export function setMockIncidentHistory(items: MockIncidentHistoryEntry[]) {
  INCIDENT_HISTORY = items;
}

export interface MockNotification {
  id: string;
  eventType: string;
  channel: string;
  payload: Record<string, unknown>;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

// Mutable in-memory fixture stores — tests reassign these arrays directly
// (e.g. `QUIZZES.length = 0` or `QUIZZES.push(...)`) to set up scenarios.
export let QUIZZES: MockQuiz[] = [];
export let QUIZ_APPROVAL_HISTORY: MockQuizApprovalHistoryEntry[] = [];
export let INCIDENTS: MockIncident[] = [];
export let NOTIFICATIONS: MockNotification[] = [];

export function setMockQuizzes(items: MockQuiz[]) {
  QUIZZES = items;
}
export function setMockQuizApprovalHistory(items: MockQuizApprovalHistoryEntry[]) {
  QUIZ_APPROVAL_HISTORY = items;
}
export function setMockIncidents(items: MockIncident[]) {
  INCIDENTS = items;
}
export function setMockNotifications(items: MockNotification[]) {
  NOTIFICATIONS = items;
}

// -- Milestone 11: Reports / Audit Log ----------------------------------

export interface MockReportJob {
  id: string;
  reportType: 'ATTENDANCE' | 'SEATING_PLAN' | 'INCIDENT_REPORT' | 'ROOM_UTILIZATION';
  format: 'CSV' | 'EXCEL';
  examSessionId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  resultUrl: string | null;
  errorMessage: string | null;
  /** Mock-only: how many times this job's status has been polled — drives the PENDING -> RUNNING -> COMPLETED/FAILED sequence. */
  pollCount: number;
}

export interface MockAuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE';
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  academicYear: number | null;
  createdAt: string;
}

export let REPORT_JOBS: Record<string, MockReportJob> = {};
export let AUDIT_LOGS: MockAuditLogEntry[] = [];
/** When set, the NEXT report job created terminates as FAILED instead of COMPLETED (after the same PENDING->RUNNING sequence). */
export let REPORT_JOB_SHOULD_FAIL = false;

export function setMockReportJobs(jobs: Record<string, MockReportJob>) {
  REPORT_JOBS = jobs;
}
export function resetMockReportJobs() {
  REPORT_JOBS = {};
}
export function setMockAuditLogs(items: MockAuditLogEntry[]) {
  AUDIT_LOGS = items;
}
export function setReportJobShouldFail(value: boolean) {
  REPORT_JOB_SHOULD_FAIL = value;
}

// -- Milestone 4 fixtures: Academic Structure + People -----------------

export interface MockDepartment {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
export interface MockProgram {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
export interface MockBatch {
  id: string;
  programId: string;
  year: string;
  section: string;
  subsection: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
export interface MockSubject {
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
export interface MockStudent {
  id: string;
  userId: string;
  name: string;
  programId: string;
  batchId: string;
  rollNumber: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
export interface MockFaculty {
  id: string;
  userId: string;
  name: string;
  departmentId: string;
  employeeCode: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
export interface MockImportJob {
  id: string;
  resourceType: string;
  status: 'COMPLETED' | 'FAILED';
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: { row: number; status: 'SUCCESS' | 'FAILURE'; id?: string; error?: string }[];
  createdByUserId: string;
  createdAt: string;
}

export let DEPARTMENTS: MockDepartment[] = [];
export let PROGRAMS: MockProgram[] = [];
export let BATCHES: MockBatch[] = [];
export let SUBJECTS: MockSubject[] = [];
export let STUDENTS: MockStudent[] = [];
export let FACULTY: MockFaculty[] = [];
export let IMPORT_JOBS: MockImportJob[] = [];

export function setMockDepartments(items: MockDepartment[]) {
  DEPARTMENTS = items;
}
export function setMockPrograms(items: MockProgram[]) {
  PROGRAMS = items;
}
export function setMockBatches(items: MockBatch[]) {
  BATCHES = items;
}
export function setMockSubjects(items: MockSubject[]) {
  SUBJECTS = items;
}
export function setMockStudents(items: MockStudent[]) {
  STUDENTS = items;
}
export function setMockFaculty(items: MockFaculty[]) {
  FACULTY = items;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
const NOW = () => new Date().toISOString();

function userFromAuthHeader(request: Request): MockUser | undefined {
  const auth = request.headers.get('Authorization');
  const token = auth?.replace('Bearer ', '');
  return token ? SESSION_TOKENS[token] : undefined;
}

// -- Milestone 6: Exam Sessions -----------------------------------------

export interface MockExamSession {
  id: string;
  name: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  status:
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
  createdByAdminId: string;
  version: number;
  /** Mock-only convenience: ids of currently-attached quizzes, resolved against QUIZZES for the detail response. */
  quizIds: string[];
  requestedRoomIds?: string[];
  backupRoomId?: string | null;
  roomAllocationStrategy?: string | null;
  roomRejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockConflictDetail {
  type: 'UNAPPROVED_QUIZ' | 'QUIZ_ALREADY_ATTACHED_ELSEWHERE' | 'STUDENT_OVERLAP' | 'ROOM_OVERLAP' | 'ROOM_UNAVAILABLE' | 'FACULTY_OVERLAP';
  quizId?: string;
  studentId?: string;
  roomId?: string;
  facultyId?: string;
  conflictingExamSessionId?: string;
  message: string;
}

export let EXAM_SESSIONS: MockExamSession[] = [];
export let EXAM_SESSION_ROOMS: { building: string; floor: number; roomNumber: string; capacity: number; rows: number; columns: number; status: string; allocatedCapacity: number; id: string }[] = [];
export let EXAM_SESSION_CONFLICT_RESULT: { hard: MockConflictDetail[]; warnings: MockConflictDetail[] } = { hard: [], warnings: [] };
export let EXAM_SESSION_RESCHEDULE_CONFLICT = false;

export function setMockExamSessions(items: MockExamSession[]) {
  EXAM_SESSIONS = items;
}
export function setMockExamSessionRooms(items: typeof EXAM_SESSION_ROOMS) {
  EXAM_SESSION_ROOMS = items;
}
export function setMockExamSessionConflictResult(result: { hard: MockConflictDetail[]; warnings: MockConflictDetail[] }) {
  EXAM_SESSION_CONFLICT_RESULT = result;
}
export function setMockExamSessionRescheduleConflict(value: boolean) {
  EXAM_SESSION_RESCHEDULE_CONFLICT = value;
}

// -- Milestone 7: Rooms / Room Allocation / Roster / Faculty Assignments -

export interface MockRoom {
  id: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  rows: number;
  columns: number;
  status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  accessibilityInfo: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockRoomSeat {
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

export interface MockAvailabilityBlock {
  id: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  createdAt: string;
}

export interface MockRosterEntry {
  id: string;
  quizId: string;
  examSessionId: string;
  studentId: string;
  status: 'ASSIGNED' | 'WAITLISTED' | 'CANCELLED';
  assignedAt: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockFacultyAssignment {
  id: string;
  facultyId: string;
  subjectId: string;
  batchId: string;
  academicYear: string;
  semester: number;
  role: 'PRIMARY_INSTRUCTOR' | 'CO_INSTRUCTOR';
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export let ROOMS: MockRoom[] = [];
export let ROOM_SEATS: MockRoomSeat[] = [];
export let AVAILABILITY_BLOCKS: MockAvailabilityBlock[] = [];
export let ROSTER: MockRosterEntry[] = [];
export let FACULTY_ASSIGNMENTS: MockFacultyAssignment[] = [];
export let ROOM_ALLOCATION_CONFLICT = false;
export let ASSIGN_STUDENTS_RESULT = { total: 0, success: 0, failure: 0 };
export let ELIGIBLE_STUDENT_COUNT = 0;

export function setMockEligibleStudentCount(count: number) {
  ELIGIBLE_STUDENT_COUNT = count;
}

export function setMockRooms(items: MockRoom[]) {
  ROOMS = items;
}
export function setMockRoomSeats(items: MockRoomSeat[]) {
  ROOM_SEATS = items;
}
export function setMockAvailabilityBlocks(items: MockAvailabilityBlock[]) {
  AVAILABILITY_BLOCKS = items;
}
export function setMockRoster(items: MockRosterEntry[]) {
  ROSTER = items;
}
export function setMockFacultyAssignments(items: MockFacultyAssignment[]) {
  FACULTY_ASSIGNMENTS = items;
}
export function setMockRoomAllocationConflict(value: boolean) {
  ROOM_ALLOCATION_CONFLICT = value;
}
export function setMockAssignStudentsResult(result: { total: number; success: number; failure: number }) {
  ASSIGN_STUDENTS_RESULT = result;
}

// -- Milestone 8: Seating ----------------------------------------------

export interface MockSeatingAssignment {
  id: string;
  seatingPlanId: string;
  studentId: string;
  quizId: string;
  seatId: string;
  createdAt: string;
}

export interface MockSeatingPlan {
  id: string;
  examSessionId: string;
  roomId: string;
  strategy: 'SEQUENTIAL' | 'RANDOMIZED' | 'ALTERNATE_SUBJECT' | 'ALTERNATE_BATCH' | 'SUBJECT_BATCH_MIX' | 'ANTI_CHEATING';
  status: 'DRAFT' | 'VALIDATED' | 'FAILED' | 'FINALIZED' | 'SUPERSEDED';
  softConstraintScore: number | null;
  violationReport: unknown[] | null;
  version: number;
  generatedAt: string;
  finalizedAt: string | null;
}

export let SEATING_PLANS: MockSeatingPlan[] = [];
export let SEATING_ASSIGNMENTS: MockSeatingAssignment[] = [];
/** When true, the NEXT generate call for a session not in SEATING_GENERATION 409s (mirrors the real status gate). */
export let SEATING_GENERATE_WRONG_STATUS = false;
/** When true, generate produces a FAILED plan with hard violations instead of VALIDATED. */
export let SEATING_GENERATE_HARD_VIOLATIONS = false;
/** When true, finalize re-validation finds fresh hard violations (BR-026 case B) even though the plan was VALIDATED. */
export let SEATING_FINALIZE_HARD_VIOLATIONS = false;

export function setMockSeatingPlans(items: MockSeatingPlan[]) {
  SEATING_PLANS = items;
}
export function setMockSeatingAssignments(items: MockSeatingAssignment[]) {
  SEATING_ASSIGNMENTS = items;
}
export function setMockSeatingGenerateWrongStatus(value: boolean) {
  SEATING_GENERATE_WRONG_STATUS = value;
}
export function setMockSeatingGenerateHardViolations(value: boolean) {
  SEATING_GENERATE_HARD_VIOLATIONS = value;
}
export function setMockSeatingFinalizeHardViolations(value: boolean) {
  SEATING_FINALIZE_HARD_VIOLATIONS = value;
}

// -- Milestone 9: Invigilation + Attendance -----------------------------

export interface MockInvigilator {
  id: string;
  examSessionId: string;
  roomId: string;
  facultyId: string;
  role: 'LEAD_INVIGILATOR' | 'ASSISTANT_INVIGILATOR';
  assignedAt: string;
  createdAt: string;
}

export interface MockAttendance {
  id: string;
  quizStudentAssignmentId: string;
  seatId: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'MEDICAL' | 'OTHER';
  method: 'MANUAL' | 'SEAT_BASED';
  markedByFacultyId: string;
  markedAt: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export let INVIGILATORS: MockInvigilator[] = [];
export let ATTENDANCE: MockAttendance[] = [];
/** When true, the NEXT invigilator assign 409s with a BR-031 overlap (details-carrying), instead of succeeding. */
export let INVIGILATOR_OVERLAP_CONFLICT = false;

export function setMockInvigilators(items: MockInvigilator[]) {
  INVIGILATORS = items;
}
export function setMockAttendance(items: MockAttendance[]) {
  ATTENDANCE = items;
}
export function setMockInvigilatorOverlapConflict(value: boolean) {
  INVIGILATOR_OVERLAP_CONFLICT = value;
}

const ANTI_CHEATING_DISCLAIMER =
  'Seating adjacency rules reduce opportunistic copying risk between neighbors; they are not a guarantee against all forms of cheating and must be combined with active invigilation.';

function toSeatingSummary(plan: MockSeatingPlan) {
  return {
    job_id: plan.id,
    seating_plan_id: plan.id,
    status: plan.status,
    soft_constraint_score: plan.softConstraintScore,
    hard_violations: plan.status === 'FAILED' ? (plan.violationReport ?? []) : [],
    soft_violations: plan.status === 'VALIDATED' ? (plan.violationReport ?? []) : [],
    ...(plan.strategy === 'ANTI_CHEATING' ? { disclaimer: ANTI_CHEATING_DISCLAIMER } : {}),
  };
}

function bodyToRoomPatch(body: Record<string, unknown>): Partial<MockRoom> {
  const patch: Partial<MockRoom> = {};
  if (body.building !== undefined) patch.building = body.building as string;
  if (body.floor !== undefined) patch.floor = body.floor as number;
  if (body.room_number !== undefined) patch.roomNumber = body.room_number as string;
  if (body.capacity !== undefined) patch.capacity = body.capacity as number;
  if (body.status !== undefined) patch.status = body.status as MockRoom['status'];
  if (body.accessibility_info !== undefined) patch.accessibilityInfo = body.accessibility_info as Record<string, unknown>;
  return patch;
}

function toExamSessionResponse(session: MockExamSession) {
  const { quizIds: _quizIds, ...rest } = session;
  void _quizIds;
  return {
    ...rest,
    requestedRoomIds: session.requestedRoomIds ?? [],
    backupRoomId: session.backupRoomId ?? null,
    roomAllocationStrategy: session.roomAllocationStrategy ?? null,
    roomRejectionReason: session.roomRejectionReason ?? null,
  };
}

function toExamSessionDetailResponse(session: MockExamSession) {
  const backupRoom = session.backupRoomId ? ROOMS.find((r) => r.id === session.backupRoomId) : undefined;
  return {
    ...toExamSessionResponse(session),
    quizzes: QUIZZES.filter((q) => session.quizIds.includes(q.id)),
    rooms: EXAM_SESSION_ROOMS,
    backupRoom: backupRoom
      ? { ...backupRoom, allocatedCapacity: 0 }
      : null,
    // No mock SeatingPlan model to derive this from — tests covering the
    // "seating done, waiting on invigilator" stepper state pass it via a
    // more targeted fixture if/when they need it; every other test just
    // gets the safe default (matches the real backend's answer whenever
    // no room has a validated/finalized plan yet).
    seatingReady: false,
  };
}

export const handlers = [
  http.post(`${API_BASE_URL}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    const record = CREDENTIALS[body.email];
    if (!record || record.password !== body.password) {
      return HttpResponse.json({ message: 'Invalid email or password.' }, { status: 401 });
    }
    return HttpResponse.json(issueTokenPair(record.user));
  }),

  http.post(`${API_BASE_URL}/auth/refresh`, async ({ request }) => {
    refreshCallCount += 1;
    const body = (await request.json()) as { refresh_token: string };
    const user = REFRESH_TOKENS[body.refresh_token];
    if (!user) {
      return HttpResponse.json({ message: 'Invalid refresh token' }, { status: 401 });
    }
    return HttpResponse.json(issueTokenPair(user));
  }),

  http.post(`${API_BASE_URL}/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /auth/change-password — mock convention: any current_password other
  // than the literal 'wrong-current-password' is treated as correct, so
  // tests can exercise both the success and failure paths simply. On
  // success, flips `mustChangePassword` false on the SAME MockUser object
  // referenced by SESSION_TOKENS, so a subsequent GET /users/me reflects it.
  http.post(`${API_BASE_URL}/auth/change-password`, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    const token = auth?.replace('Bearer ', '');
    const user = token ? SESSION_TOKENS[token] : undefined;
    if (!user) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const body = (await request.json()) as { current_password?: string; new_password?: string };
    if (body.current_password === 'wrong-current-password') {
      return HttpResponse.json({ message: 'Current password is incorrect.' }, { status: 401 });
    }
    if (!body.new_password || body.new_password.length < 8 || !/\d/.test(body.new_password)) {
      return HttpResponse.json({ message: 'Password must be at least 8 characters and contain a number.' }, { status: 400 });
    }
    user.mustChangePassword = false;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE_URL}/users/me`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    const token = auth?.replace('Bearer ', '');
    const user = token ? SESSION_TOKENS[token] : undefined;
    if (!user) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return HttpResponse.json(user);
  }),

  http.get(`${API_BASE_URL}/quizzes/eligible-student-count`, () => {
    return HttpResponse.json({ count: ELIGIBLE_STUDENT_COUNT });
  }),

  // GET /quizzes — self-scopes: FACULTY sees only quizzes it "created"
  // (faculty id resolved from the mock user's id, mirroring the real
  // backend scoping by the calling actor), ADMIN sees everything.
  // Optional `status` filter mirrors the real query param.
  http.get(`${API_BASE_URL}/quizzes`, ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const subjectId = url.searchParams.get('subject_id');

    let items = QUIZZES;
    if (user.roles.includes('FACULTY')) {
      items = items.filter((q) => q.createdByFacultyId === user.id);
    }
    if (status) {
      items = items.filter((q) => q.status === status);
    }
    if (subjectId) {
      items = items.filter((q) => q.subjectId === subjectId);
    }
    const enriched = items.map((q) => {
      const session = EXAM_SESSIONS.find((s) => s.quizIds.includes(q.id));
      return { ...q, examSession: session ? { id: session.id, status: session.status } : null };
    });
    return HttpResponse.json({ items: enriched, next_cursor: null });
  }),

  http.post(`${API_BASE_URL}/quizzes`, async ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body.title ||
      !body.subject_id ||
      !Array.isArray(body.batch_ids) ||
      (body.batch_ids as unknown[]).length === 0 ||
      !body.academic_year ||
      !body.semester ||
      !body.student_count ||
      !body.preferred_date ||
      !body.preferred_time
    ) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    const created: MockQuiz = {
      id: nextId('quiz'),
      title: body.title as string,
      status: 'DRAFT',
      subjectId: body.subject_id as string,
      createdByFacultyId: user.id,
      durationMinutes: (body.duration_minutes as number | undefined) ?? null,
      studentCount: (body.student_count as number | undefined) ?? null,
      instructions: (body.instructions as string | undefined) ?? null,
      quizType: (body.quiz_type as string | undefined) ?? null,
      preferredDate: (body.preferred_date as string | undefined) ?? null,
      preferredTime: (body.preferred_time as string | undefined) ?? null,
      academicYear: body.academic_year as string,
      semester: body.semester as number,
      requestedRoomIds: [],
      backupRoomId: null,
      roomAllocationStrategy: null,
      version: 1,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    QUIZZES = [...QUIZZES, created];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get(`${API_BASE_URL}/quizzes/:id`, ({ params }) => {
    const quiz = QUIZZES.find((q) => q.id === params.id);
    if (!quiz) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS.find((s) => s.quizIds.includes(quiz.id));
    const examSession = session
      ? {
          id: session.id,
          status: session.status,
          rooms: EXAM_SESSION_ROOMS.map((r) => ({
            id: r.id,
            building: r.building,
            floor: r.floor,
            roomNumber: r.roomNumber,
            capacity: r.capacity,
            allocatedCapacity: r.allocatedCapacity,
          })),
        }
      : null;
    return HttpResponse.json({ ...quiz, examSession });
  }),

  http.patch(`${API_BASE_URL}/quizzes/:id`, async ({ request, params }) => {
    const ifMatch = request.headers.get('if-match');
    const idx = QUIZZES.findIndex((q) => q.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (ifMatch === null || Number.isNaN(Number(ifMatch))) {
      return HttpResponse.json({ message: 'An "If-Match" header carrying the current version is required.' }, { status: 400 });
    }
    if ((QUIZZES[idx].version ?? 1) !== Number(ifMatch)) {
      return HttpResponse.json({ message: 'Quiz has been modified since it was last read (version mismatch).' }, { status: 409 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    QUIZZES[idx] = {
      ...QUIZZES[idx],
      ...(body.title !== undefined ? { title: body.title as string } : {}),
      ...(body.subject_id !== undefined ? { subjectId: body.subject_id as string } : {}),
      ...(body.academic_year !== undefined ? { academicYear: body.academic_year as string } : {}),
      ...(body.semester !== undefined ? { semester: body.semester as number } : {}),
      ...(body.duration_minutes !== undefined ? { durationMinutes: body.duration_minutes as number } : {}),
      ...(body.student_count !== undefined ? { studentCount: body.student_count as number } : {}),
      ...(body.instructions !== undefined ? { instructions: body.instructions as string } : {}),
      ...(body.quiz_type !== undefined ? { quizType: body.quiz_type as string } : {}),
      ...(body.preferred_date !== undefined ? { preferredDate: body.preferred_date as string } : {}),
      ...(body.preferred_time !== undefined ? { preferredTime: body.preferred_time as string } : {}),
      version: (QUIZZES[idx].version ?? 1) + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(QUIZZES[idx]);
  }),

  http.post(`${API_BASE_URL}/quizzes/:id/submit`, ({ params }) => {
    const idx = QUIZZES.findIndex((q) => q.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const quiz = QUIZZES[idx];
    if (quiz.status !== 'DRAFT' && quiz.status !== 'REJECTED') {
      return HttpResponse.json({ message: `Quiz is in status "${quiz.status}" and cannot be submitted from this state.` }, { status: 409 });
    }
    const missing: string[] = [];
    if (quiz.durationMinutes == null) missing.push('duration_minutes');
    if (quiz.studentCount == null) missing.push('student_count');
    if (quiz.quizType == null) missing.push('quiz_type');
    if (quiz.preferredDate == null) missing.push('preferred_date');
    if (quiz.preferredTime == null) missing.push('preferred_time');
    if (missing.length > 0) {
      return HttpResponse.json(
        { message: `Quiz is missing required fields before it can be submitted: ${missing.join(', ')}.` },
        { status: 422 },
      );
    }
    const previousStatus = quiz.status;
    QUIZZES[idx] = { ...quiz, status: 'SUBMITTED', version: (quiz.version ?? 1) + 1, updatedAt: NOW() };
    QUIZ_APPROVAL_HISTORY = [
      ...QUIZ_APPROVAL_HISTORY,
      {
        id: nextId('hist'),
        quizId: quiz.id,
        action: previousStatus === 'REJECTED' ? 'RESUBMITTED' : 'SUBMITTED',
        actorId: quiz.createdByFacultyId,
        reason: null,
        previousStatus,
        newStatus: 'SUBMITTED',
        createdAt: NOW(),
      },
    ];
    return HttpResponse.json(QUIZZES[idx]);
  }),

  http.post(`${API_BASE_URL}/quizzes/:id/approve`, ({ request, params }) => {
    const user = userFromAuthHeader(request);
    const ifMatch = request.headers.get('if-match');
    const idx = QUIZZES.findIndex((q) => q.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (ifMatch === null || Number.isNaN(Number(ifMatch))) {
      return HttpResponse.json({ message: 'An "If-Match" header carrying the current version is required.' }, { status: 400 });
    }
    const quiz = QUIZZES[idx];
    if (quiz.status !== 'SUBMITTED') {
      return HttpResponse.json({ message: `Quiz is in status "${quiz.status}" and cannot be approved.` }, { status: 409 });
    }
    if ((quiz.version ?? 1) !== Number(ifMatch)) {
      return HttpResponse.json({ message: 'Quiz has been modified since it was last read (version mismatch).' }, { status: 409 });
    }
    QUIZZES[idx] = { ...quiz, status: 'APPROVED', version: (quiz.version ?? 1) + 1, updatedAt: NOW() };
    QUIZ_APPROVAL_HISTORY = [
      ...QUIZ_APPROVAL_HISTORY,
      {
        id: nextId('hist'),
        quizId: quiz.id,
        action: 'APPROVED',
        actorId: user?.id ?? 'u-admin',
        reason: null,
        previousStatus: 'SUBMITTED',
        newStatus: 'APPROVED',
        createdAt: NOW(),
      },
    ];
    return HttpResponse.json(QUIZZES[idx]);
  }),

  http.post(`${API_BASE_URL}/quizzes/:id/reject`, async ({ request, params }) => {
    const user = userFromAuthHeader(request);
    const idx = QUIZZES.findIndex((q) => q.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const quiz = QUIZZES[idx];
    if (quiz.status !== 'SUBMITTED') {
      return HttpResponse.json({ message: `Quiz is in status "${quiz.status}" and cannot be rejected.` }, { status: 409 });
    }
    const body = (await request.json()) as { reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return HttpResponse.json({ message: 'A rejection reason is required (BR-012).' }, { status: 422 });
    }
    QUIZZES[idx] = { ...quiz, status: 'REJECTED', version: (quiz.version ?? 1) + 1, updatedAt: NOW() };
    QUIZ_APPROVAL_HISTORY = [
      ...QUIZ_APPROVAL_HISTORY,
      {
        id: nextId('hist'),
        quizId: quiz.id,
        action: 'REJECTED',
        actorId: user?.id ?? 'u-admin',
        reason: body.reason,
        previousStatus: 'SUBMITTED',
        newStatus: 'REJECTED',
        createdAt: NOW(),
      },
    ];
    return HttpResponse.json(QUIZZES[idx]);
  }),

  http.get(`${API_BASE_URL}/quizzes/:id/approval-history`, ({ params }) => {
    const items = QUIZ_APPROVAL_HISTORY.filter((h) => h.quizId === params.id);
    return HttpResponse.json(items);
  }),

  // GET /incidents — self-scopes: FACULTY sees only incidents it reported
  // (reporter resolved from the mock user's id), ADMIN sees everything.
  http.get(`${API_BASE_URL}/incidents`, ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const severity = url.searchParams.get('severity');

    // Mock scoping is intentionally simple: fixtures are set up per test to
    // already represent "what this actor would see" (the real backend does
    // the actor-scoping server-side; these handlers don't need to re-derive
    // faculty/student domain ids to exercise dashboard rendering).
    let items = INCIDENTS;
    if (status) items = items.filter((i) => i.status === status);
    if (severity) items = items.filter((i) => i.severity === severity);
    return HttpResponse.json({ items, next_cursor: null });
  }),

  // POST /incidents — FACULTY only. BR-037: caller must be an invigilator
  // on the named session — `setIncidentNotInvigilator(true)` simulates the
  // 403 case for tests.
  http.post(`${API_BASE_URL}/incidents`, async ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    if (INCIDENT_NOT_INVIGILATOR) {
      return HttpResponse.json(
        { message: 'You are not an invigilator for this exam session (BR-037).' },
        { status: 403 },
      );
    }
    const body = (await request.json()) as {
      exam_session_id?: string;
      incident_type?: string;
      severity?: MockIncident['severity'];
      description?: string;
      quiz_id?: string;
      student_id?: string;
      room_id?: string;
      seat_id?: string;
    };
    if (!body.exam_session_id || !body.incident_type || !body.severity || !body.description) {
      return HttpResponse.json({ message: 'Validation failed', statusCode: 422 }, { status: 422 });
    }
    const incident: MockIncident = {
      id: nextId('incident'),
      incidentType: body.incident_type,
      severity: body.severity,
      status: 'OPEN',
      examSessionId: body.exam_session_id,
      quizId: body.quiz_id ?? null,
      studentId: body.student_id ?? null,
      roomId: body.room_id ?? null,
      seatId: body.seat_id ?? null,
      description: body.description,
      resolution: null,
      notes: null,
      reporterId: user.id,
      createdAt: NOW(),
    };
    INCIDENTS = [...INCIDENTS, incident];
    INCIDENT_HISTORY = [
      ...INCIDENT_HISTORY,
      {
        id: nextId('inc-hist'),
        incidentId: incident.id,
        action: 'CREATE',
        actorId: user.id,
        previousStatus: null,
        newStatus: 'OPEN',
        resolution: null,
        notes: null,
        createdAt: NOW(),
      },
    ];
    return HttpResponse.json(incident, { status: 201 });
  }),

  // PATCH /incidents/:id/status — ADMIN only. Validates the transition
  // graph server-side (409 if invalid) and requires `resolution` for
  // RESOLVE/DISMISS (422 if missing) — matches the real service exactly.
  http.patch(`${API_BASE_URL}/incidents/:id/status`, async ({ params, request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const idx = INCIDENTS.findIndex((i) => i.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const incident = INCIDENTS[idx];
    const body = (await request.json()) as { action: string; resolution?: string; notes?: string };

    const VALID_TRANSITIONS: Record<string, { from: string[]; to: MockIncident['status'] }> = {
      INVESTIGATE: { from: ['OPEN', 'ESCALATED'], to: 'UNDER_REVIEW' },
      ESCALATE: { from: ['UNDER_REVIEW'], to: 'ESCALATED' },
      RESOLVE: { from: ['UNDER_REVIEW'], to: 'RESOLVED' },
      DISMISS: { from: ['UNDER_REVIEW'], to: 'DISMISSED' },
    };
    const transition = VALID_TRANSITIONS[body.action];
    if (!transition || !transition.from.includes(incident.status)) {
      return HttpResponse.json(
        {
          message: `Incident is in status "${incident.status}" — action "${body.action}" is not a valid transition from there.`,
        },
        { status: 409 },
      );
    }
    if ((body.action === 'RESOLVE' || body.action === 'DISMISS') && !body.resolution?.trim()) {
      return HttpResponse.json({ message: 'A resolution is required for this action.' }, { status: 422 });
    }

    const previousStatus = incident.status;
    const updated: MockIncident = {
      ...incident,
      status: transition.to,
      resolution: body.resolution ?? incident.resolution,
      notes: body.notes ?? incident.notes,
    };
    INCIDENTS[idx] = updated;
    INCIDENT_HISTORY = [
      ...INCIDENT_HISTORY,
      {
        id: nextId('inc-hist'),
        incidentId: incident.id,
        action: body.action as MockIncidentHistoryEntry['action'],
        actorId: user.id,
        previousStatus,
        newStatus: transition.to,
        resolution: body.resolution ?? null,
        notes: body.notes ?? null,
        createdAt: NOW(),
      },
    ];
    return HttpResponse.json(updated);
  }),

  // GET /incidents/:id/history — ADMIN only.
  http.get(`${API_BASE_URL}/incidents/:id/history`, ({ params, request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    if (!user.roles.includes('ADMIN')) {
      return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    const items = INCIDENT_HISTORY.filter((h) => h.incidentId === params.id);
    return HttpResponse.json(items);
  }),

  // GET /me/notifications — self-scoped to the caller, all roles.
  http.get(`${API_BASE_URL}/me/notifications`, ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    return HttpResponse.json({ items: NOTIFICATIONS, next_cursor: null });
  }),

  // -- Departments ---------------------------------------------------
  http.get(`${API_BASE_URL}/departments`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    let items = DEPARTMENTS;
    if (status) items = items.filter((d) => d.status === status);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((d) => d.name.toLowerCase().includes(s) || d.code.toLowerCase().includes(s));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post(`${API_BASE_URL}/departments`, async ({ request }) => {
    const body = (await request.json()) as { name: string; code: string };
    if (!body.name || !body.code) {
      return HttpResponse.json({ message: 'Validation failed', statusCode: 400 }, { status: 400 });
    }
    if (DEPARTMENTS.some((d) => d.code === body.code)) {
      return HttpResponse.json({ message: `Department code "${body.code}" already exists.` }, { status: 409 });
    }
    const created: MockDepartment = {
      id: nextId('dept'),
      name: body.name,
      code: body.code,
      status: 'ACTIVE',
      metadata: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    DEPARTMENTS = [...DEPARTMENTS, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/departments/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockDepartment>;
    const idx = DEPARTMENTS.findIndex((d) => d.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (body.code && DEPARTMENTS.some((d) => d.code === body.code && d.id !== params.id)) {
      return HttpResponse.json({ message: `Department code "${body.code}" already exists.` }, { status: 409 });
    }
    DEPARTMENTS[idx] = { ...DEPARTMENTS[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(DEPARTMENTS[idx]);
  }),

  // -- Programs --------------------------------------------------------
  http.get(`${API_BASE_URL}/programs`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const departmentId = url.searchParams.get('department_id');
    let items = PROGRAMS;
    if (status) items = items.filter((p) => p.status === status);
    if (departmentId) items = items.filter((p) => p.departmentId === departmentId);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post(`${API_BASE_URL}/programs`, async ({ request }) => {
    const body = (await request.json()) as { department_id: string; name: string; code: string };
    if (!body.department_id || !body.name || !body.code) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    if (!DEPARTMENTS.some((d) => d.id === body.department_id)) {
      return HttpResponse.json({ message: 'Department not found' }, { status: 404 });
    }
    if (PROGRAMS.some((p) => p.code === body.code)) {
      return HttpResponse.json({ message: `Program code "${body.code}" already exists.` }, { status: 409 });
    }
    const created: MockProgram = {
      id: nextId('prog'),
      departmentId: body.department_id,
      name: body.name,
      code: body.code,
      status: 'ACTIVE',
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    PROGRAMS = [...PROGRAMS, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/programs/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockProgram>;
    const idx = PROGRAMS.findIndex((p) => p.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (body.code && PROGRAMS.some((p) => p.code === body.code && p.id !== params.id)) {
      return HttpResponse.json({ message: `Program code "${body.code}" already exists.` }, { status: 409 });
    }
    PROGRAMS[idx] = { ...PROGRAMS[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(PROGRAMS[idx]);
  }),

  // -- Batches -----------------------------------------------------------
  http.get(`${API_BASE_URL}/batches`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const programId = url.searchParams.get('program_id');
    let items = BATCHES;
    if (status) items = items.filter((b) => b.status === status);
    if (programId) items = items.filter((b) => b.programId === programId);
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post(`${API_BASE_URL}/batches`, async ({ request }) => {
    const body = (await request.json()) as {
      program_id: string;
      year: string;
      section: string;
      subsection: string;
    };
    if (!body.program_id || !body.year || !body.section || !body.subsection) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    if (!PROGRAMS.some((p) => p.id === body.program_id)) {
      return HttpResponse.json({ message: 'Program not found' }, { status: 404 });
    }
    if (
      BATCHES.some(
        (b) =>
          b.programId === body.program_id &&
          b.year === body.year &&
          b.section === body.section &&
          b.subsection === body.subsection,
      )
    ) {
      return HttpResponse.json(
        { message: 'Batch with this program/year/section/subsection already exists.' },
        { status: 409 },
      );
    }
    const created: MockBatch = {
      id: nextId('batch'),
      programId: body.program_id,
      year: body.year,
      section: body.section,
      subsection: body.subsection,
      status: 'ACTIVE',
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    BATCHES = [...BATCHES, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/batches/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockBatch>;
    const idx = BATCHES.findIndex((b) => b.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    BATCHES[idx] = { ...BATCHES[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(BATCHES[idx]);
  }),

  // -- Subjects ------------------------------------------------------
  http.get(`${API_BASE_URL}/subjects`, ({ request }) => {
    const url = new URL(request.url);
    const isActive = url.searchParams.get('isActive');
    const search = url.searchParams.get('search');
    const departmentId = url.searchParams.get('department_id');
    let items = SUBJECTS;
    if (isActive !== null) items = items.filter((s) => s.isActive === (isActive === 'true'));
    if (departmentId) items = items.filter((s) => s.departmentId === departmentId);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((it) => it.name.toLowerCase().includes(s) || it.code.toLowerCase().includes(s));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post(`${API_BASE_URL}/subjects`, async ({ request }) => {
    const body = (await request.json()) as { department_id: string; program_id?: string; code: string; name: string; credits?: number };
    if (!body.department_id || !body.code || !body.name) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    if (SUBJECTS.some((s) => s.code === body.code)) {
      return HttpResponse.json({ message: `Subject code "${body.code}" already exists.` }, { status: 409 });
    }
    const created: MockSubject = {
      id: nextId('subj'),
      departmentId: body.department_id,
      programId: body.program_id ?? null,
      code: body.code,
      name: body.name,
      credits: body.credits ?? null,
      isActive: true,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    SUBJECTS = [...SUBJECTS, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/subjects/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockSubject>;
    const idx = SUBJECTS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (body.code && SUBJECTS.some((s) => s.code === body.code && s.id !== params.id)) {
      return HttpResponse.json({ message: `Subject code "${body.code}" already exists.` }, { status: 409 });
    }
    SUBJECTS[idx] = { ...SUBJECTS[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(SUBJECTS[idx]);
  }),

  // -- Students --------------------------------------------------------
  http.get(`${API_BASE_URL}/students`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const batchId = url.searchParams.get('batch_id');
    let items = STUDENTS;
    if (status) items = items.filter((s) => s.status === status);
    if (batchId) items = items.filter((s) => s.batchId === batchId);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((it) => it.name.toLowerCase().includes(s) || it.rollNumber.toLowerCase().includes(s));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post(`${API_BASE_URL}/students`, async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; program_id: string; batch_id: string; roll_number: string };
    if (!body.name || !body.email || !body.program_id || !body.batch_id || !body.roll_number) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    if (STUDENTS.some((s) => s.rollNumber === body.roll_number)) {
      return HttpResponse.json({ message: `Roll number "${body.roll_number}" already exists.` }, { status: 409 });
    }
    const created: MockStudent = {
      id: nextId('stu'),
      userId: nextId('user'),
      name: body.name,
      programId: body.program_id,
      batchId: body.batch_id,
      rollNumber: body.roll_number,
      status: 'ACTIVE',
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    STUDENTS = [...STUDENTS, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/students/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockStudent>;
    const idx = STUDENTS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (body.rollNumber && STUDENTS.some((s) => s.rollNumber === body.rollNumber && s.id !== params.id)) {
      return HttpResponse.json({ message: `Roll number "${body.rollNumber}" already exists.` }, { status: 409 });
    }
    STUDENTS[idx] = { ...STUDENTS[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(STUDENTS[idx]);
  }),
  http.post(`${API_BASE_URL}/students/bulk-import`, async () => {
    const job: MockImportJob = {
      id: nextId('job'),
      resourceType: 'students',
      status: 'COMPLETED',
      totalRows: 1,
      successCount: 1,
      failureCount: 0,
      results: [{ row: 2, status: 'SUCCESS', id: nextId('stu') }],
      createdByUserId: 'u-admin',
      createdAt: NOW(),
    };
    IMPORT_JOBS = [...IMPORT_JOBS, job];
    return HttpResponse.json({ job_id: job.id }, { status: 202 });
  }),

  // -- Faculty -----------------------------------------------------------
  http.get(`${API_BASE_URL}/faculty`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    let items = FACULTY;
    if (status) items = items.filter((f) => f.status === status);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((it) => it.name.toLowerCase().includes(s) || it.employeeCode.toLowerCase().includes(s));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.get(`${API_BASE_URL}/faculty/me`, ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const faculty = FACULTY.find((f) => f.userId === user.id);
    if (!faculty) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(faculty);
  }),
  http.post(`${API_BASE_URL}/faculty`, async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; department_id: string; employee_code: string };
    if (!body.name || !body.email || !body.department_id || !body.employee_code) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    if (FACULTY.some((f) => f.employeeCode === body.employee_code)) {
      return HttpResponse.json({ message: `Employee code "${body.employee_code}" already exists.` }, { status: 409 });
    }
    const created: MockFaculty = {
      id: nextId('fac'),
      userId: nextId('user'),
      name: body.name,
      departmentId: body.department_id,
      employeeCode: body.employee_code,
      status: 'ACTIVE',
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    FACULTY = [...FACULTY, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${API_BASE_URL}/faculty/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<MockFaculty>;
    const idx = FACULTY.findIndex((f) => f.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (body.employeeCode && FACULTY.some((f) => f.employeeCode === body.employeeCode && f.id !== params.id)) {
      return HttpResponse.json({ message: `Employee code "${body.employeeCode}" already exists.` }, { status: 409 });
    }
    FACULTY[idx] = { ...FACULTY[idx], ...body, updatedAt: NOW() };
    return HttpResponse.json(FACULTY[idx]);
  }),

  // -- Import jobs -------------------------------------------------------
  http.get(`${API_BASE_URL}/import-jobs/:id`, ({ params }) => {
    const job = IMPORT_JOBS.find((j) => j.id === params.id);
    if (!job) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(job);
  }),

  // -- Exam Sessions (Milestone 6) ----------------------------------------
  http.post(`${API_BASE_URL}/exam-sessions`, async ({ request }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name || !body.session_date || !body.start_time || !body.end_time) {
      return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
    }
    const created: MockExamSession = {
      id: nextId('session'),
      name: body.name as string,
      sessionDate: body.session_date as string,
      startTime: body.start_time as string,
      endTime: body.end_time as string,
      status: 'DRAFT',
      createdByAdminId: user.id,
      version: 1,
      quizIds: [],
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    EXAM_SESSIONS = [...EXAM_SESSIONS, created];
    return HttpResponse.json(toExamSessionResponse(created), { status: 201 });
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id`, ({ params }) => {
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(toExamSessionDetailResponse(session));
  }),

  http.patch(`${API_BASE_URL}/exam-sessions/:id/quizzes`, async ({ request, params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    if (session.status !== 'DRAFT') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and its quizzes can only be changed while DRAFT.` },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { add: string[]; remove: string[] };
    const hardConflicts: { type: string; quizId: string; message: string }[] = [];
    for (const quizId of body.add) {
      const quiz = QUIZZES.find((q) => q.id === quizId);
      if (quiz && quiz.status !== 'APPROVED') {
        hardConflicts.push({ type: 'UNAPPROVED_QUIZ', quizId, message: `Quiz "${quizId}" is not APPROVED.` });
      }
    }
    if (hardConflicts.length > 0) {
      return HttpResponse.json(
        { message: 'One or more quizzes could not be attached due to hard conflicts.', details: hardConflicts },
        { status: 409 },
      );
    }
    const quizIds = new Set(session.quizIds);
    for (const id of body.remove) quizIds.delete(id);
    for (const id of body.add) quizIds.add(id);
    EXAM_SESSIONS[idx] = { ...session, quizIds: [...quizIds], version: session.version + 1, updatedAt: NOW() };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/reschedule`, async ({ request, params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    if (session.status !== 'DRAFT') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and cannot be rescheduled.` },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { session_date: string; start_time: string; end_time: string };
    if (EXAM_SESSION_RESCHEDULE_CONFLICT) {
      return HttpResponse.json(
        {
          message: 'Rescheduling would introduce hard conflicts.',
          details: [
            { type: 'STUDENT_OVERLAP', studentId: 'stu-1', conflictingExamSessionId: 'other-session', message: 'Student stu-1 already has an exam scheduled in this window.' },
          ],
        },
        { status: 409 },
      );
    }
    EXAM_SESSIONS[idx] = {
      ...session,
      sessionDate: body.session_date,
      startTime: body.start_time,
      endTime: body.end_time,
      version: session.version + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/cancel`, async ({ request, params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(session.status)) {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and cannot be cancelled.` },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return HttpResponse.json({ message: 'A cancellation reason is required.' }, { status: 422 });
    }
    EXAM_SESSIONS[idx] = { ...session, status: 'CANCELLED', quizIds: [], version: session.version + 1, updatedAt: NOW() };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id/conflicts`, ({ params }) => {
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(EXAM_SESSION_CONFLICT_RESULT);
  }),

  // -- Milestone 7: Rooms ---------------------------------------------
  http.post(`${API_BASE_URL}/rooms`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const room: MockRoom = {
      id: nextId('room'),
      building: body.building as string,
      floor: body.floor as number,
      roomNumber: body.room_number as string,
      capacity: body.capacity as number,
      rows: body.rows as number,
      columns: body.columns as number,
      status: 'ACTIVE',
      accessibilityInfo: (body.accessibility_info as Record<string, unknown> | undefined) ?? null,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    ROOMS = [...ROOMS, room];
    const seats: MockRoomSeat[] = [];
    for (let r = 0; r < room.rows; r++) {
      for (let c = 0; c < room.columns; c++) {
        seats.push({
          id: nextId('seat'),
          roomId: room.id,
          seatLabel: `${String.fromCharCode(65 + r)}${c + 1}`,
          rowIndex: r,
          colIndex: c,
          isAccessible: false,
          isActive: true,
          createdAt: NOW(),
          updatedAt: NOW(),
        });
      }
    }
    ROOM_SEATS = [...ROOM_SEATS, ...seats];
    return HttpResponse.json(room, { status: 201 });
  }),

  http.get(`${API_BASE_URL}/rooms/available`, ({ request }) => {
    const url = new URL(request.url);
    const minCapacity = url.searchParams.get('min_capacity');
    const items = ROOMS.filter(
      (r) => r.status === 'ACTIVE' && (!minCapacity || r.capacity >= Number(minCapacity)),
    );
    return HttpResponse.json(items);
  }),

  http.get(`${API_BASE_URL}/rooms/availability`, ({ request }) => {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    const items = (roomId ? ROOMS.filter((r) => r.id === roomId) : ROOMS).map((room) => ({
      room,
      bookedRanges: ROOM_ALLOCATION_CONFLICT
        ? [{ start_time: '09:00:00', end_time: '11:00:00', source: 'EXAM_SESSION' as const, exam_session_name: 'Conflicting Session' }]
        : [],
    }));
    return HttpResponse.json(items);
  }),

  http.get(`${API_BASE_URL}/rooms`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    const status = url.searchParams.get('status');
    const building = url.searchParams.get('building');
    let items = ROOMS;
    if (search) items = items.filter((r) => r.roomNumber.toLowerCase().includes(search.toLowerCase()));
    if (status) items = items.filter((r) => r.status === status);
    if (building) items = items.filter((r) => r.building === building);
    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.get(`${API_BASE_URL}/rooms/:id`, ({ params }) => {
    const room = ROOMS.find((r) => r.id === params.id);
    if (!room) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(room);
  }),

  http.patch(`${API_BASE_URL}/rooms/:id`, async ({ request, params }) => {
    const idx = ROOMS.findIndex((r) => r.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const updated = { ...ROOMS[idx], ...bodyToRoomPatch(body), updatedAt: NOW() };
    ROOMS[idx] = updated;
    return HttpResponse.json(updated);
  }),

  http.get(`${API_BASE_URL}/rooms/:id/seats`, ({ params }) => {
    return HttpResponse.json(ROOM_SEATS.filter((s) => s.roomId === params.id));
  }),

  http.patch(`${API_BASE_URL}/rooms/:id/seats/:seatId`, async ({ request, params }) => {
    const idx = ROOM_SEATS.findIndex((s) => s.id === params.seatId && s.roomId === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const body = (await request.json()) as { is_active?: boolean; is_accessible?: boolean };
    const updated: MockRoomSeat = {
      ...ROOM_SEATS[idx],
      isActive: body.is_active ?? ROOM_SEATS[idx].isActive,
      isAccessible: body.is_accessible ?? ROOM_SEATS[idx].isAccessible,
      updatedAt: NOW(),
    };
    ROOM_SEATS[idx] = updated;
    return HttpResponse.json(updated);
  }),

  http.post(`${API_BASE_URL}/rooms/:id/availability-blocks`, async ({ request, params }) => {
    const body = (await request.json()) as { date: string; start_time: string; end_time: string; reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return HttpResponse.json({ message: 'A reason is required.' }, { status: 422 });
    }
    const block: MockAvailabilityBlock = {
      id: nextId('block'),
      roomId: params.id as string,
      date: body.date,
      startTime: body.start_time,
      endTime: body.end_time,
      reason: body.reason,
      createdAt: NOW(),
    };
    AVAILABILITY_BLOCKS = [...AVAILABILITY_BLOCKS, block];
    return HttpResponse.json(block, { status: 201 });
  }),

  http.get(`${API_BASE_URL}/rooms/:id/availability-blocks`, ({ params }) => {
    return HttpResponse.json({ items: AVAILABILITY_BLOCKS.filter((b) => b.roomId === params.id), next_cursor: null });
  }),

  // -- Quiz-stage room suggestion + request (before any exam session exists) --
  http.get(`${API_BASE_URL}/quizzes/:id/rooms/suggest`, ({ params }) => {
    const quiz = QUIZZES.find((q) => q.id === params.id);
    if (!quiz) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const totalStudents = quiz.studentCount ?? 0;
    if (totalStudents === 0) {
      return HttpResponse.json({ message: 'Set student_count on the quiz before requesting room suggestions.' }, { status: 409 });
    }
    const available = ROOMS.filter((r) => r.status === 'ACTIVE');
    const sorted = [...available].sort((a, b) => b.capacity - a.capacity);
    const rooms: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number; allocated: number }[] = [];
    let remaining = totalStudents;
    for (const r of sorted) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, r.capacity);
      rooms.push({ roomId: r.id, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity, allocated });
      remaining -= allocated;
    }
    const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
    const strategy = (strategyKey: string, label: string, description: string) => ({
      strategy: strategyKey,
      label,
      description,
      roomCount: rooms.length,
      totalCapacity,
      utilizationPercent: totalCapacity === 0 ? 0 : Math.round((totalStudents / totalCapacity) * 100),
      rooms,
    });
    const allRooms = [...available]
      .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
      .map((r) => ({ roomId: r.id, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity }));
    return HttpResponse.json({
      totalStudents,
      shortfall: totalCapacity < totalStudents,
      availableRoomCount: available.length,
      strategies: [
        strategy('FEWEST_ROOMS', 'Fewest Classes', 'Largest rooms first, filled to capacity.'),
        strategy('SEQUENTIAL', 'Sequential (Adjacent Rooms)', 'Building/room-number order.'),
        strategy('BALANCED_SPREAD', 'Balanced Spread', 'Same rooms, spread evenly.'),
      ],
      allRooms,
    });
  }),

  http.post(`${API_BASE_URL}/quizzes/:id/rooms/request`, async ({ request, params }) => {
    const idx = QUIZZES.findIndex((q) => q.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const user = userFromAuthHeader(request);
    const isAdmin = user?.roles?.includes('ADMIN') ?? false;
    const body = (await request.json()) as { room_ids: string[]; backup_room_id?: string; strategy?: string; admin_note?: string };
    QUIZZES[idx] = {
      ...QUIZZES[idx],
      requestedRoomIds: body.room_ids,
      backupRoomId: body.backup_room_id ?? null,
      roomAllocationStrategy: body.strategy ?? null,
      roomAdjustmentNote: isAdmin ? (body.admin_note ?? null) : null,
    };
    return HttpResponse.json(QUIZZES[idx]);
  }),

  http.get(`${API_BASE_URL}/quizzes/:id/rooms/conflicts`, ({ params }) => {
    const quiz = QUIZZES.find((q) => q.id === params.id);
    if (!quiz) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const toRow = (roomId: string) => {
      const room = ROOMS.find((r) => r.id === roomId);
      if (!room) return { roomId, building: '—', floor: 0, roomNumber: '—', capacity: 0, available: false, reason: 'Room no longer exists.' };
      const available = !ROOM_ALLOCATION_CONFLICT;
      return {
        roomId: room.id,
        building: room.building,
        floor: room.floor,
        roomNumber: room.roomNumber,
        capacity: room.capacity,
        available,
        reason: available ? undefined : 'Room already booked for an overlapping session.',
        alternatives: available
          ? undefined
          : ROOMS.filter((r) => r.status === 'ACTIVE' && r.id !== roomId && r.capacity >= room.capacity).map((r) => ({
              roomId: r.id,
              building: r.building,
              floor: r.floor,
              roomNumber: r.roomNumber,
              capacity: r.capacity,
            })),
      };
    };
    return HttpResponse.json({
      requestedRooms: (quiz.requestedRoomIds ?? []).map(toRow),
      backupRoom: quiz.backupRoomId ? toRow(quiz.backupRoomId) : null,
      strategy: quiz.roomAllocationStrategy ?? null,
      studentConflicts: [],
    });
  }),

  // -- Milestone 7 / room-request-approval: Room Allocation -------------
  http.get(`${API_BASE_URL}/exam-sessions/:id/rooms/suggest`, ({ params }) => {
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const totalStudents = ROSTER.filter((r) => r.examSessionId === session.id && r.status === 'ASSIGNED').length;
    if (totalStudents === 0) {
      return HttpResponse.json({ message: 'This session has no ASSIGNED students to size room suggestions for.' }, { status: 409 });
    }
    const available = ROOMS.filter((r) => r.status === 'ACTIVE');
    const sorted = [...available].sort((a, b) => b.capacity - a.capacity);
    const rooms: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number; allocated: number }[] = [];
    let remaining = totalStudents;
    for (const r of sorted) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, r.capacity);
      rooms.push({ roomId: r.id, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity, allocated });
      remaining -= allocated;
    }
    const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
    const strategy = (strategyKey: string, label: string, description: string) => ({
      strategy: strategyKey,
      label,
      description,
      roomCount: rooms.length,
      totalCapacity,
      utilizationPercent: totalCapacity === 0 ? 0 : Math.round((totalStudents / totalCapacity) * 100),
      rooms,
    });
    const allRooms = [...available]
      .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
      .map((r) => ({ roomId: r.id, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity }));
    return HttpResponse.json({
      totalStudents,
      shortfall: totalCapacity < totalStudents,
      availableRoomCount: available.length,
      strategies: [
        strategy('FEWEST_ROOMS', 'Fewest Classes', 'Largest rooms first, filled to capacity.'),
        strategy('SEQUENTIAL', 'Sequential (Adjacent Rooms)', 'Building/room-number order.'),
        strategy('BALANCED_SPREAD', 'Balanced Spread', 'Same rooms, spread evenly.'),
      ],
      allRooms,
    });
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/rooms/request`, async ({ request, params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const body = (await request.json()) as { room_ids: string[]; backup_room_id?: string; strategy?: string };
    EXAM_SESSIONS[idx] = {
      ...EXAM_SESSIONS[idx],
      status: 'ROOM_ALLOCATION',
      requestedRoomIds: body.room_ids,
      backupRoomId: body.backup_room_id ?? null,
      roomAllocationStrategy: body.strategy ?? null,
      roomRejectionReason: null,
      version: EXAM_SESSIONS[idx].version + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id/rooms/preview`, ({ params }) => {
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const toRow = (roomId: string) => {
      const room = ROOMS.find((r) => r.id === roomId);
      if (!room) return { roomId, building: '—', floor: 0, roomNumber: '—', capacity: 0, available: false, reason: 'Room no longer exists.' };
      const available = !ROOM_ALLOCATION_CONFLICT;
      return {
        roomId: room.id,
        building: room.building,
        floor: room.floor,
        roomNumber: room.roomNumber,
        capacity: room.capacity,
        available,
        reason: available ? undefined : 'Room already booked for an overlapping session.',
        alternatives: available
          ? undefined
          : ROOMS.filter((r) => r.status === 'ACTIVE' && r.id !== roomId && r.capacity >= room.capacity).map((r) => ({
              roomId: r.id,
              building: r.building,
              floor: r.floor,
              roomNumber: r.roomNumber,
              capacity: r.capacity,
            })),
      };
    };
    return HttpResponse.json({
      requestedRooms: (session.requestedRoomIds ?? []).map(toRow),
      backupRoom: session.backupRoomId ? toRow(session.backupRoomId) : null,
      strategy: session.roomAllocationStrategy ?? null,
      studentConflicts: [],
    });
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/rooms/reject`, async ({ request, params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const body = (await request.json()) as { reason: string };
    EXAM_SESSIONS[idx] = {
      ...EXAM_SESSIONS[idx],
      status: 'ASSIGNING_STUDENTS',
      requestedRoomIds: [],
      backupRoomId: null,
      roomRejectionReason: body.reason,
      version: EXAM_SESSIONS[idx].version + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/rooms/allocate-preapproved`, ({ params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    const attachedQuizzes = QUIZZES.filter((q) => session.quizIds.includes(q.id));
    if (attachedQuizzes.length === 0 || attachedQuizzes.some((q) => (q.requestedRoomIds ?? []).length === 0)) {
      return HttpResponse.json({ message: 'One or more attached quizzes has no admin-approved room request.' }, { status: 409 });
    }
    if (ROOM_ALLOCATION_CONFLICT) {
      return HttpResponse.json(
        {
          message: 'Insufficient room capacity for this session — allocation aborted (EC-011).',
          details: [{ type: 'ROOM_UNAVAILABLE', message: 'Shortfall: 5 student(s), no additional capacity in the selected rooms.' }],
        },
        { status: 409 },
      );
    }
    EXAM_SESSIONS[idx] = {
      ...EXAM_SESSIONS[idx],
      status: 'SEATING_GENERATION',
      requestedRoomIds: [],
      backupRoomId: null,
      roomRejectionReason: null,
      version: EXAM_SESSIONS[idx].version + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/rooms/allocate`, async ({ params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (ROOM_ALLOCATION_CONFLICT) {
      return HttpResponse.json(
        {
          message: 'Insufficient room capacity for this session — allocation aborted (EC-011).',
          details: [{ type: 'ROOM_UNAVAILABLE', message: 'Shortfall: 5 student(s), no additional capacity in the selected rooms.' }],
        },
        { status: 409 },
      );
    }
    EXAM_SESSIONS[idx] = {
      ...EXAM_SESSIONS[idx],
      status: 'SEATING_GENERATION',
      requestedRoomIds: [],
      backupRoomId: null,
      roomRejectionReason: null,
      version: EXAM_SESSIONS[idx].version + 1,
      updatedAt: NOW(),
    };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  // -- Milestone 7: Student Assignment (roster) -------------------------
  http.post(`${API_BASE_URL}/exam-sessions/:id/assign-students`, ({ params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    EXAM_SESSIONS[idx] = { ...EXAM_SESSIONS[idx], status: 'ASSIGNING_STUDENTS', version: EXAM_SESSIONS[idx].version + 1, updatedAt: NOW() };
    return HttpResponse.json(
      {
        job_id: nextId('job'),
        status: 'COMPLETED',
        total_rows: ASSIGN_STUDENTS_RESULT.total,
        success_count: ASSIGN_STUDENTS_RESULT.success,
        failure_count: ASSIGN_STUDENTS_RESULT.failure,
        exam_session: toExamSessionResponse(EXAM_SESSIONS[idx]),
      },
      { status: 202 },
    );
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id/roster`, ({ params, request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let items = ROSTER.filter((r) => r.examSessionId === params.id);
    if (status) items = items.filter((r) => r.status === status);
    // Mirrors the real backend's join (StudentAssignmentService.getRoster)
    // so the roster response resolves human-readable labels the same way
    // in tests — including for a detached quiz (e.g. after cancellation),
    // where these labels must come from the row itself, not the session's
    // current `quizzes` list.
    const withLabels = items.map((r) => {
      const quiz = QUIZZES.find((q) => q.id === r.quizId);
      const student = STUDENTS.find((s) => s.id === r.studentId);
      return {
        ...r,
        quizTitle: quiz?.title ?? r.quizId,
        studentName: student?.name ?? r.studentId,
        studentRollNumber: student?.rollNumber ?? '',
      };
    });
    return HttpResponse.json({ items: withLabels, next_cursor: null });
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/roster/:studentId`, async ({ request, params }) => {
    const body = (await request.json()) as { quiz_id: string };
    const entry: MockRosterEntry = {
      id: nextId('roster'),
      quizId: body.quiz_id,
      examSessionId: params.id as string,
      studentId: params.studentId as string,
      status: 'ASSIGNED',
      assignedAt: NOW(),
      cancelledAt: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    ROSTER = [...ROSTER, entry];
    return HttpResponse.json(entry, { status: 201 });
  }),

  http.delete(`${API_BASE_URL}/exam-sessions/:id/roster/:studentId`, async ({ request, params }) => {
    const body = (await request.json()) as { quiz_id: string; reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return HttpResponse.json({ message: 'A reason is required.' }, { status: 422 });
    }
    const idx = ROSTER.findIndex(
      (r) => r.examSessionId === params.id && r.studentId === params.studentId && r.quizId === body.quiz_id,
    );
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    ROSTER[idx] = { ...ROSTER[idx], status: 'CANCELLED', cancelledAt: NOW(), updatedAt: NOW() };
    return HttpResponse.json(ROSTER[idx]);
  }),

  // -- Milestone 7: Faculty Assignments ----------------------------------
  http.post(`${API_BASE_URL}/faculty-assignments`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const dup = FACULTY_ASSIGNMENTS.find(
      (a) =>
        !a.endedAt &&
        a.facultyId === body.faculty_id &&
        a.subjectId === body.subject_id &&
        a.batchId === body.batch_id &&
        a.academicYear === body.academic_year &&
        a.semester === body.semester,
    );
    if (dup) {
      return HttpResponse.json({ message: 'This faculty assignment already exists (BR-009).' }, { status: 409 });
    }
    const assignment: MockFacultyAssignment = {
      id: nextId('fa'),
      facultyId: body.faculty_id as string,
      subjectId: body.subject_id as string,
      batchId: body.batch_id as string,
      academicYear: body.academic_year as string,
      semester: body.semester as number,
      role: body.role as 'PRIMARY_INSTRUCTOR' | 'CO_INSTRUCTOR',
      createdAt: NOW(),
      updatedAt: NOW(),
      endedAt: null,
    };
    FACULTY_ASSIGNMENTS = [...FACULTY_ASSIGNMENTS, assignment];
    return HttpResponse.json(assignment, { status: 201 });
  }),

  http.delete(`${API_BASE_URL}/faculty-assignments/:id`, ({ params }) => {
    const idx = FACULTY_ASSIGNMENTS.findIndex((a) => a.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    FACULTY_ASSIGNMENTS[idx] = { ...FACULTY_ASSIGNMENTS[idx], endedAt: NOW(), updatedAt: NOW() };
    return HttpResponse.json(FACULTY_ASSIGNMENTS[idx]);
  }),

  http.get(`${API_BASE_URL}/faculty/:id/assignments`, ({ params }) => {
    return HttpResponse.json({ items: FACULTY_ASSIGNMENTS.filter((a) => a.facultyId === params.id), next_cursor: null });
  }),

  // -- Milestone 8: Seating ----------------------------------------------
  http.post(`${API_BASE_URL}/exam-sessions/:id/seating/generate`, async ({ request, params }) => {
    const body = (await request.json()) as { room_id: string; strategy: MockSeatingPlan['strategy'] };
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    // EC-032 idempotency: an existing DRAFT/VALIDATED/FINALIZED plan for
    // this (session, room) short-circuits to that plan's summary, checked
    // BEFORE the status gate — mirrors seating-engine.service.ts.
    const existing = SEATING_PLANS.find(
      (p) => p.examSessionId === session.id && p.roomId === body.room_id && p.status !== 'SUPERSEDED' && p.status !== 'FAILED',
    );
    if (existing) {
      return HttpResponse.json(toSeatingSummary(existing), { status: 202 });
    }

    if (SEATING_GENERATE_WRONG_STATUS || session.status !== 'SEATING_GENERATION') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and seating can only be generated while SEATING_GENERATION.` },
        { status: 409 },
      );
    }

    const planId = nextId('seating-plan');
    const failed = SEATING_GENERATE_HARD_VIOLATIONS;
    const violations = failed
      ? [{ type: 'SEAT_DOUBLE_BOOKED', message: 'Seat A1 is assigned to two students.' }]
      : [{ type: 'ADJACENT_SAME_SUBJECT', message: 'Seats A1 and A2 share the same subject.' }];

    const plan: MockSeatingPlan = {
      id: planId,
      examSessionId: session.id,
      roomId: body.room_id,
      strategy: body.strategy,
      status: failed ? 'FAILED' : 'VALIDATED',
      softConstraintScore: failed ? null : 0.85,
      violationReport: violations,
      version: 1,
      generatedAt: NOW(),
      finalizedAt: null,
    };
    SEATING_PLANS = [...SEATING_PLANS, plan];

    if (!failed) {
      const seatsForRoom = ROOM_SEATS.filter((s) => s.roomId === body.room_id && s.isActive);
      const rosterForSession = ROSTER.filter((r) => r.examSessionId === session.id && r.status === 'ASSIGNED');
      SEATING_ASSIGNMENTS = [
        ...SEATING_ASSIGNMENTS,
        ...rosterForSession.slice(0, seatsForRoom.length).map((r, i) => ({
          id: nextId('seating-assignment'),
          seatingPlanId: planId,
          studentId: r.studentId,
          quizId: r.quizId,
          seatId: seatsForRoom[i].id,
          createdAt: NOW(),
        })),
      ];
    }

    return HttpResponse.json(toSeatingSummary(plan), { status: 202 });
  }),

  http.get(`${API_BASE_URL}/seating-jobs/:id`, ({ params }) => {
    const plan = SEATING_PLANS.find((p) => p.id === params.id);
    if (!plan) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    return HttpResponse.json(toSeatingSummary(plan));
  }),

  http.get(`${API_BASE_URL}/seating-plans/:id`, ({ params }) => {
    const plan = SEATING_PLANS.find((p) => p.id === params.id);
    if (!plan) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const assignments = SEATING_ASSIGNMENTS.filter((a) => a.seatingPlanId === plan.id).map((a) => ({
      ...a,
      seat: ROOM_SEATS.find((s) => s.id === a.seatId),
      student: STUDENTS.find((s) => s.id === a.studentId),
      quiz: (() => {
        const q = QUIZZES.find((qz) => qz.id === a.quizId);
        return q ? { id: q.id, title: q.title } : undefined;
      })(),
    }));
    return HttpResponse.json({ ...plan, assignments });
  }),

  http.post(`${API_BASE_URL}/seating-plans/:id/finalize`, ({ params }) => {
    const idx = SEATING_PLANS.findIndex((p) => p.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const plan = SEATING_PLANS[idx];
    if (plan.status !== 'VALIDATED') {
      return HttpResponse.json(
        { message: `Seating plan is in status "${plan.status}" and can only be finalized from VALIDATED.` },
        { status: 409 },
      );
    }
    if (SEATING_FINALIZE_HARD_VIOLATIONS) {
      return HttpResponse.json(
        {
          message: 'This seating plan has hard constraint violations and cannot be finalized (BR-026).',
          details: [{ type: 'SEAT_DOUBLE_BOOKED', message: 'A newly-added roster entry now conflicts with an existing seat assignment.' }],
        },
        { status: 409 },
      );
    }
    SEATING_PLANS[idx] = { ...plan, status: 'FINALIZED', finalizedAt: NOW() };
    return HttpResponse.json(SEATING_PLANS[idx]);
  }),

  // -- Milestone 9: Invigilation -------------------------------------------
  http.post(`${API_BASE_URL}/exam-sessions/:id/invigilators`, async ({ request, params }) => {
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (session.status === 'CANCELLED') {
      return HttpResponse.json(
        { message: 'This exam session is CANCELLED and cannot receive new invigilator assignments.' },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { room_id: string; faculty_id: string; role: MockInvigilator['role'] };
    const allocatedRoom = EXAM_SESSION_ROOMS.find((r) => r.id === body.room_id);
    if (!allocatedRoom) {
      return HttpResponse.json({ message: 'This room is not allocated to this exam session.' }, { status: 404 });
    }
    const existing = INVIGILATORS.find(
      (i) => i.examSessionId === session.id && i.roomId === body.room_id && i.facultyId === body.faculty_id,
    );
    if (existing) {
      return HttpResponse.json(
        { message: 'This faculty is already assigned as an invigilator for this room and session.' },
        { status: 409 },
      );
    }
    if (INVIGILATOR_OVERLAP_CONFLICT) {
      return HttpResponse.json(
        {
          message: 'This faculty is already invigilating an overlapping session (BR-031).',
          details: [{ type: 'FACULTY_OVERLAP', facultyId: body.faculty_id, conflictingExamSessionId: 'session-other', message: 'This faculty is already invigilating an overlapping session.' }],
        },
        { status: 409 },
      );
    }
    const created: MockInvigilator = {
      id: nextId('invigilator'),
      examSessionId: session.id,
      roomId: body.room_id,
      facultyId: body.faculty_id,
      role: body.role,
      assignedAt: NOW(),
      createdAt: NOW(),
    };
    INVIGILATORS = [...INVIGILATORS, created];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete(`${API_BASE_URL}/exam-sessions/:id/invigilators/:invigilatorId`, ({ params }) => {
    const existing = INVIGILATORS.find((i) => i.id === params.invigilatorId && i.examSessionId === params.id);
    if (!existing) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    INVIGILATORS = INVIGILATORS.filter((i) => i.id !== params.invigilatorId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE_URL}/faculty/:id/invigilation-duties`, ({ params }) => {
    const items = INVIGILATORS.filter((i) => i.facultyId === params.id).map((i) => {
      const session = EXAM_SESSIONS.find((s) => s.id === i.examSessionId);
      const room = ROOMS.find((r) => r.id === i.roomId);
      return {
        ...i,
        examSession: session
          ? { name: session.name, sessionDate: session.sessionDate, startTime: session.startTime, endTime: session.endTime, status: session.status }
          : { name: i.examSessionId, sessionDate: '', startTime: '', endTime: '', status: 'DRAFT' },
        room: room ? { building: room.building, roomNumber: room.roomNumber } : { building: '', roomNumber: i.roomId },
      };
    });
    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id/invigilators`, ({ params }) => {
    const items = INVIGILATORS.filter((i) => i.examSessionId === params.id);
    return HttpResponse.json({ items, next_cursor: null });
  }),

  // -- Milestone 9: Attendance ----------------------------------------------
  http.post(`${API_BASE_URL}/exam-sessions/:id/attendance`, async ({ request, params }) => {
    const user = userFromAuthHeader(request);
    if (!user) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const session = EXAM_SESSIONS.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (session.status === 'CANCELLED') {
      return HttpResponse.json({ message: 'Attendance cannot be marked for a CANCELLED exam session (BR-036).' }, { status: 409 });
    }
    if (session.status !== 'IN_PROGRESS') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" — attendance can only be marked while IN_PROGRESS (BR-032).` },
        { status: 422 },
      );
    }
    const body = (await request.json()) as { student_id: string; status: MockAttendance['status']; method: MockAttendance['method'] };
    const assignment = ROSTER.find((r) => r.examSessionId === session.id && r.studentId === body.student_id && r.status === 'ASSIGNED');
    if (!assignment) {
      return HttpResponse.json({ message: 'This student has no active assignment in this exam session (BR-032).' }, { status: 404 });
    }
    const existing = ATTENDANCE.find((a) => a.quizStudentAssignmentId === assignment.id);
    if (existing) {
      return HttpResponse.json({ message: 'Attendance has already been recorded for this student in this quiz (BR-033).' }, { status: 409 });
    }
    const seatingAssignment = SEATING_ASSIGNMENTS.find((sa) => {
      if (sa.quizId !== assignment.quizId || sa.studentId !== body.student_id) return false;
      const plan = SEATING_PLANS.find((p) => p.id === sa.seatingPlanId);
      return plan?.examSessionId === session.id && plan.status === 'FINALIZED';
    });
    if (!seatingAssignment) {
      return HttpResponse.json({ message: 'No finalized seat assignment exists for this student in this session.' }, { status: 409 });
    }
    const created: MockAttendance = {
      id: nextId('attendance'),
      quizStudentAssignmentId: assignment.id,
      seatId: seatingAssignment.seatId,
      status: body.status,
      method: body.method,
      markedByFacultyId: user.id,
      markedAt: NOW(),
      locked: false,
      createdAt: NOW(),
      updatedAt: NOW(),
    };
    ATTENDANCE = [...ATTENDANCE, created];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(`${API_BASE_URL}/attendance/:id`, async ({ request, params }) => {
    const idx = ATTENDANCE.findIndex((a) => a.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const existing = ATTENDANCE[idx];
    const body = (await request.json()) as { status: MockAttendance['status']; reason?: string };
    if (body.status === existing.status) {
      return HttpResponse.json(existing);
    }
    if (existing.locked && !body.reason) {
      return HttpResponse.json(
        { message: 'This attendance record is locked — a reason is required to change it (BR-035).' },
        { status: 423 },
      );
    }
    ATTENDANCE[idx] = { ...existing, status: body.status, updatedAt: NOW() };
    return HttpResponse.json(ATTENDANCE[idx]);
  }),

  http.get(`${API_BASE_URL}/exam-sessions/:id/attendance`, ({ params }) => {
    const rosterById = new Map(ROSTER.filter((r) => r.examSessionId === params.id).map((r) => [r.id, r]));
    const items = ATTENDANCE.filter((a) => rosterById.has(a.quizStudentAssignmentId)).map((a) => {
      const roster = rosterById.get(a.quizStudentAssignmentId)!;
      const student = STUDENTS.find((s) => s.id === roster.studentId);
      const quiz = QUIZZES.find((q) => q.id === roster.quizId);
      const seat = ROOM_SEATS.find((s) => s.id === a.seatId);
      return {
        ...a,
        quizStudentAssignment: {
          student: { name: student?.name ?? roster.studentId, rollNumber: student?.rollNumber ?? '' },
          quiz: { title: quiz?.title ?? roster.quizId },
        },
        seat: { seatLabel: seat?.seatLabel ?? a.seatId },
      };
    });
    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.get(`${API_BASE_URL}/students/:id/attendance-history`, ({ params }) => {
    const assignmentIds = new Set(ROSTER.filter((r) => r.studentId === params.id).map((r) => r.id));
    const items = ATTENDANCE.filter((a) => assignmentIds.has(a.quizStudentAssignmentId)).map((a) => ({ ...a, history: [] }));
    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/start`, ({ params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    if (session.status !== 'READY_FOR_FINALIZATION') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and can only be started from READY_FOR_FINALIZATION.` },
        { status: 409 },
      );
    }
    const allocatedRoomIds = EXAM_SESSION_ROOMS.map((r) => r.id);
    const finalizedRoomIds = new Set(
      SEATING_PLANS.filter((p) => p.examSessionId === session.id && p.status === 'FINALIZED').map((p) => p.roomId),
    );
    const notReady = allocatedRoomIds.filter((id) => !finalizedRoomIds.has(id));
    if (allocatedRoomIds.length === 0 || notReady.length > 0) {
      return HttpResponse.json(
        {
          message: 'Every allocated room must have a FINALIZED seating plan before the session can start.',
          details: notReady.map((roomId) => ({ type: 'SEATING_NOT_FINALIZED', roomId })),
        },
        { status: 409 },
      );
    }
    EXAM_SESSIONS[idx] = { ...session, status: 'IN_PROGRESS', version: session.version + 1, updatedAt: NOW() };
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  http.post(`${API_BASE_URL}/exam-sessions/:id/complete`, ({ params }) => {
    const idx = EXAM_SESSIONS.findIndex((s) => s.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const session = EXAM_SESSIONS[idx];
    if (session.status !== 'IN_PROGRESS') {
      return HttpResponse.json(
        { message: `Exam session is in status "${session.status}" and can only be completed from IN_PROGRESS.` },
        { status: 409 },
      );
    }
    EXAM_SESSIONS[idx] = { ...session, status: 'COMPLETED', version: session.version + 1, updatedAt: NOW() };
    const assignmentIds = new Set(ROSTER.filter((r) => r.examSessionId === session.id).map((r) => r.id));
    ATTENDANCE = ATTENDANCE.map((a) => (assignmentIds.has(a.quizStudentAssignmentId) ? { ...a, locked: true } : a));
    return HttpResponse.json(toExamSessionResponse(EXAM_SESSIONS[idx]));
  }),

  // PATCH /me/notifications/:id/read — self-scoped, idempotent.
  http.patch(`${API_BASE_URL}/me/notifications/:id/read`, ({ params }) => {
    const idx = NOTIFICATIONS.findIndex((n) => n.id === params.id);
    if (idx === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (!NOTIFICATIONS[idx].readAt) {
      NOTIFICATIONS[idx] = { ...NOTIFICATIONS[idx], readAt: NOW() };
    }
    return HttpResponse.json(NOTIFICATIONS[idx]);
  }),

  // -- Milestone 11: Reports -----------------------------------------------
  // POST /reports/{type} — 202 {job_id}. Each new job starts PENDING and
  // advances PENDING -> RUNNING -> COMPLETED|FAILED across successive polls
  // of GET /report-jobs/:id (stateful via `pollCount`), so tests can watch
  // real polling progress rather than an instant terminal state.
  ...(['attendance', 'seating-plan', 'incident-report', 'room-utilization'] as const).map((path) => {
    const reportType = (
      { attendance: 'ATTENDANCE', 'seating-plan': 'SEATING_PLAN', 'incident-report': 'INCIDENT_REPORT', 'room-utilization': 'ROOM_UTILIZATION' } as const
    )[path];
    return http.post(`${API_BASE_URL}/reports/${path}`, async ({ request }) => {
      const body = (await request.json()) as { exam_session_id?: string; format?: 'CSV' | 'EXCEL' };
      if (!body.exam_session_id || !body.format) {
        return HttpResponse.json({ message: 'Validation failed' }, { status: 400 });
      }
      const id = nextId('report-job');
      REPORT_JOBS[id] = {
        id,
        reportType,
        format: body.format,
        examSessionId: body.exam_session_id,
        status: 'PENDING',
        resultUrl: null,
        errorMessage: null,
        pollCount: 0,
      };
      return HttpResponse.json({ job_id: id }, { status: 202 });
    });
  }),

  http.get(`${API_BASE_URL}/report-jobs/:id`, ({ params }) => {
    const job = REPORT_JOBS[params.id as string];
    if (!job) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (job.status === 'PENDING') {
      job.status = job.pollCount >= 1 ? 'RUNNING' : 'PENDING';
      job.pollCount += 1;
    } else if (job.status === 'RUNNING') {
      if (job.pollCount >= 2) {
        if (REPORT_JOB_SHOULD_FAIL) {
          job.status = 'FAILED';
          job.errorMessage = 'The exam session has no attendance records to export.';
        } else {
          job.status = 'COMPLETED';
          job.resultUrl = `/report-jobs/${job.id}/download`;
        }
      }
      job.pollCount += 1;
    }
    return HttpResponse.json({
      job_id: job.id,
      status: job.status,
      download_url: job.resultUrl,
      error_message: job.errorMessage,
    });
  }),

  http.get(`${API_BASE_URL}/report-jobs/:id/download`, ({ params }) => {
    const job = REPORT_JOBS[params.id as string];
    if (!job || job.status !== 'COMPLETED') {
      return HttpResponse.json({ message: 'Report is not ready to download.' }, { status: 409 });
    }
    const contentType = job.format === 'CSV' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const filename = `report-${job.id}.${job.format === 'CSV' ? 'csv' : 'xlsx'}`;
    return new HttpResponse('mock,report,data\n1,2,3', {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }),

  // -- Milestone 11: Audit Log ----------------------------------------------
  http.get(`${API_BASE_URL}/audit-logs`, ({ request }) => {
    const url = new URL(request.url);
    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');
    const actorId = url.searchParams.get('actor_id');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');

    let items = AUDIT_LOGS;
    if (entityType) items = items.filter((a) => a.entityType === entityType);
    if (entityId) items = items.filter((a) => a.entityId === entityId);
    if (actorId) items = items.filter((a) => a.actorId === actorId);
    if (dateFrom) items = items.filter((a) => a.createdAt >= dateFrom);
    if (dateTo) items = items.filter((a) => a.createdAt <= dateTo);
    return HttpResponse.json({ items, next_cursor: null });
  }),
];
