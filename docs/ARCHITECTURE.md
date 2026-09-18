# Exam-Sync: University Examination & Quiz Management Platform
### Production Architecture Document — v1.0

---

## A. Executive Summary

Exam-Sync manages the full lifecycle of academic quizzes/exams: academic structure setup, enrollment, faculty assignment, quiz authoring, admin approval, multi-subject exam session scheduling, intelligent room/seat allocation with cheating-risk reduction, attendance, incident management, notifications, and audit reporting.

**Design posture:** correctness and data integrity first, then security, reliability, scalability, performance, maintainability. We explicitly avoid speculative complexity (no premature microservices, no sharding until proven necessary) while keeping every module cleanly bounded so it *can* be extracted later.

**Recommended architecture:** Modular monolith (single deployable, domain-bounded modules, one primary Postgres database) + async workers for seating/notifications/exports. This serves 10K→100K+ students without microservices overhead, and each module's clean boundary (own tables, own service layer, event-based inter-module communication) is what makes future extraction possible instead of a rewrite.

**Non-negotiable invariants**, enforced at the database level wherever physically possible, not just in application code:
- A seat cannot hold two students at once (unique constraint).
- A student cannot be in two exams at overlapping times (constraint + transactional check).
- A room cannot be double-booked (constraint + transactional check).
- Attendance cannot be duplicated (unique constraint).
- State transitions (quiz, exam session, seating) follow an explicit state machine — no arbitrary jumps.

---

## B. Requirements

### Functional
- Manage department → program → batch → subject → student/faculty structure (many-to-many where real).
- Student-subject enrollment independent of batch membership.
- Faculty-subject-batch assignment (who teaches whom).
- Quiz authoring restricted to authorized faculty; DRAFT → APPROVED lifecycle with admin gate.
- Combine multiple approved quizzes into one Exam Session (multi-subject, multi-faculty).
- Allocate rooms and generate seating with configurable, constraint-based anti-cheating strategies.
- Record attendance (manual, seat-based, QR — biometric-ready).
- Report and triage incidents with severity and workflow.
- Notify students/faculty asynchronously, reliably, idempotently.
- Full audit trail on every state-changing action.
- Role-scoped dashboards for Admin / Faculty / Student / Invigilator.

### Non-Functional
| Dimension | Target |
|---|---|
| Scale | 10K → 50K → 100K+ students, no hard cap |
| Availability | 99.9% during exam windows; degrade gracefully otherwise |
| Consistency | Strong consistency for booking/seating/attendance; eventual for notifications/dashboards |
| Latency (p95) | Reads < 300ms, writes < 500ms, seating generation async |
| Security | RBAC + resource-level authorization, full audit log |
| Durability | No silent data loss; every write auditable |

### Constraints / Assumptions (explicit — revisit with stakeholders)
1. **Single university/tenant** initially. Multi-tenant is a future extension (add `tenant_id` column now, unused, to avoid painful migration later) — **unresolved decision**, confirm before Phase 1 schema freeze.
2. One admin role initially, but schema supports multiple admins from day one (no singleton assumptions).
3. Faculty CAN invigilate exams for subjects they do not teach.
4. A quiz creator does not need to be the invigilator.
5. Rejected quizzes can be edited and resubmitted (assumed allowed — confirm).
6. Students cannot self-enroll in subjects; enrollment is admin/faculty-driven (assumed — confirm against real registration workflow).
7. "Quiz" and "Exam" are used interchangeably for a single-subject assessment; "Exam Session" is the multi-subject combined event.

---

## C. Actors

| Actor | Description |
|---|---|
| **Admin** | Approves quizzes, manages academic structure, allocates rooms, resolves incidents, views all data. Multiple admins supported (row-level `created_by`/`approved_by`, no singleton logic). |
| **Faculty** | Teaches subject(s) to batch(es), creates quizzes for authorized subject+batch pairs, may invigilate any session, marks attendance, reports incidents. |
| **Student** | Enrolled in subjects, takes quizzes, views own schedule/seat/attendance, never modifies seating or attendance. |
| **Invigilator** | A Faculty acting in a room-assignment capacity for a session (not a separate person type — a *role played by* Faculty for a given session/room). |
| **System/Worker** | Background processes: seating engine, notification dispatcher, export generator, conflict checker. |

---

## D. Academic Domain Model

```
University (implicit root, tenant_id reserved)
  └─ Department (1) ──── (N) Program
                 (1) ──── (N) Subject
                 (1) ──── (N) Faculty            [faculty.department_id — home dept]
                 (1) ──── (N) Student  (via Program, see below)

  Program (1) ──── (N) Batch
  Program (1) ──── (N) Subject   [subjects can belong to a program's curriculum]

  Batch (1) ──── (N) Student     [primary batch membership]

  --- Many-to-many cores (the actual hard part) ---
  Faculty  (M) ──── (N) Subject  ──── (N) Batch     via faculty_subject_batch_assignment
  Student  (M) ──── (N) Subject                      via student_subject_enrollment
  Quiz     (1) ──── (N) exam_session_quizzes ──── (N) Exam Session
  Exam Session (M) ──── (N) Room                    via exam_session_rooms
  Exam Session (M) ──── (N) Faculty (invigilators)  via exam_invigilators
  Student  (1) ──── (1) seat per (exam_session, quiz) via seating_assignments
```

Key principle: **nothing is inferred transitively**. Batch membership does NOT imply subject eligibility (enrollment governs that). Subject does NOT imply a single faculty (assignment table governs that). Room does NOT imply single subject (seating assignment governs that per-seat).

---

## E. Student Mapping

`students` holds identity + `program_id` + `batch_id` (primary/administrative batch — used for default reporting, not exam eligibility).

Exam eligibility path:
```
Student → student_subject_enrollment (status=ENROLLED) → Subject
        → faculty_subject_batch_assignment (subject, student.batch_id) → Faculty (who teaches them)
        → Quiz (subject, batch, status=APPROVED) → quiz_student_assignment → Exam Session
        → seating_assignment → Room + Seat
        → attendance
```
A student can appear in **N concurrent enrollment rows**, each independently droppable/completable, which is what makes "different faculty for different subjects" fall out naturally rather than needing special-casing.

---

## F. Faculty Mapping

**Decision: yes, a dedicated `faculty_subject_batch_assignment` table is required.** Rationale:

- Problem: `Subject → Faculty` (1:1 or naive M:N without batch) cannot express "Faculty A teaches DBMS to Batch A and B, Faculty B teaches DBMS to Batch C."
- Alternative considered: store faculty list as an array/JSON column on subject. Rejected — can't query "which students does Faculty X currently teach," can't enforce uniqueness, can't audit assignment changes, breaks 1NF guarantees needed for conflict checking.
- Alternative considered: `student ↔ faculty` direct mapping. Rejected — redundant, drifts from the subject/batch source of truth, and doesn't let you ask "who teaches DBMS to Batch B" without joining through students.
- **Recommended:** `faculty_subject_batch_assignment(faculty_id, subject_id, batch_id, academic_year, semester, role)` as the single source of truth. `role` distinguishes PRIMARY_INSTRUCTOR vs CO_INSTRUCTOR for collaboration cases. Quiz authorization, "my students," and attendance rosters all derive from this table — zero duplication.

---

## G. Subject Mapping

Subject is a catalog entity (`code`, `name`, `department_id`, `credits`, `is_active`). It does **not** hold faculty or batch references. All relationships route through `faculty_subject_batch_assignment` (teaching) and `student_subject_enrollment` (learning). This is the deliberate normalization choice that lets the same subject be taught differently to different cohorts without duplicating the subject row.

---

## H. Batch Mapping

Batch (`program_id`, `year`, `section`, e.g. "CSE-2026-A") is a cohort grouping for administrative purposes (default roster, primary reporting unit) — **not** an exam-eligibility gate. Batch is one of the dimensions in `faculty_subject_batch_assignment` and appears as a seating-diversity attribute.

---

## I. Department Mapping

```sql
departments(
  id UUID PK,
  name TEXT NOT NULL,
  code TEXT NOT NULL,        -- 'CSE'
  status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | INACTIVE
  metadata JSONB,
  created_at, updated_at
)
UNIQUE (code)
```
Inactive departments block new assignments/enrollments but never cascade-delete history (soft boundary via status flag, not row deletion — see §37 soft-delete strategy).

---

## J. Enrollment Model

```sql
student_subject_enrollment(
  id UUID PK,
  student_id UUID FK,
  subject_id UUID FK,
  batch_id UUID FK,               -- batch context at enrollment time (student may change batch later)
  academic_year TEXT,
  semester INT,
  status TEXT,                    -- ENROLLED|DROPPED|COMPLETED|INACTIVE|WITHDRAWN
  enrolled_at TIMESTAMPTZ,
  dropped_at TIMESTAMPTZ NULL,
  created_at, updated_at
)
UNIQUE (student_id, subject_id, academic_year, semester)  -- prevents duplicate enrollment
```
**Quiz eligibility rule** (business logic, enforced server-side at assignment time, re-validated at finalization):
```
eligible = enrollment.status = 'ENROLLED'
       AND enrollment.subject_id = quiz.subject_id
       AND enrollment.academic_year = quiz.academic_year
       AND enrollment.semester = quiz.semester (if applicable)
```
Dropping a subject after scheduling does not retroactively delete seating history — see Edge Case #16.

---

## K. Quiz Lifecycle

```sql
quizzes(
  id UUID PK,
  title TEXT,
  subject_id UUID FK,
  created_by_faculty_id UUID FK,
  duration_minutes INT,
  total_marks NUMERIC,
  question_count INT,
  instructions TEXT,
  quiz_type TEXT,               -- QUIZ|MIDTERM|FINAL|...
  preferred_date DATE,
  preferred_time TIME,
  academic_year TEXT,
  semester INT,
  status TEXT NOT NULL,         -- see state machine, §11/K
  version INT NOT NULL DEFAULT 1,   -- optimistic lock
  created_at, updated_at
)
quiz_batches(quiz_id, batch_id)   -- M:N — a quiz can target multiple batches of the same subject
```
Faculty may only create a quiz for `(subject_id, batch_id)` pairs present in their own `faculty_subject_batch_assignment` rows — enforced server-side, not client-side (§ Data Integrity).

---

## L. Admin Approval Workflow

```sql
quiz_approval_history(
  id UUID PK,
  quiz_id UUID FK,
  action TEXT,            -- SUBMITTED|APPROVED|REJECTED|RESUBMITTED
  actor_id UUID FK,        -- admin or faculty
  reason TEXT NULL,        -- required when action=REJECTED
  previous_status TEXT,
  new_status TEXT,
  created_at TIMESTAMPTZ
)
```
**Append-only.** Never update or delete rows — each decision is a new row, giving a complete, tamper-evident timeline. `quizzes.status` is the current-state cache; history is the ledger. Rejection requires a non-null `reason` (CHECK constraint: `action != 'REJECTED' OR reason IS NOT NULL`).

---

## M. Multi-Faculty Collaboration

Collaboration happens at two levels:
1. **Assignment level**: `faculty_subject_batch_assignment.role IN ('PRIMARY_INSTRUCTOR','CO_INSTRUCTOR')` lets two faculty jointly own a subject+batch pairing (both can create/edit quizzes for it — configurable).
2. **Session level**: an Exam Session naturally aggregates quizzes from different faculty (§N) — this is where "Faculty A's DBMS quiz + Faculty B's OS quiz, same room/time" is realized, with each retaining ownership of their own quiz while the session is a separate aggregate root.

---

## N. Exam Session Model

```sql
exam_sessions(
  id UUID PK,
  name TEXT,                       -- "Mid-Sem Week 1 — Slot A"
  session_date DATE,
  start_time TIME,
  end_time TIME,
  status TEXT,                     -- mirrors quiz-adjacent lifecycle, see §11
  created_by_admin_id UUID FK,
  version INT DEFAULT 1,
  created_at, updated_at
)
exam_session_quizzes(
  exam_session_id UUID FK,
  quiz_id UUID FK,
  PRIMARY KEY (exam_session_id, quiz_id)
)
```
An Exam Session is the aggregate root for scheduling, room allocation, seating, invigilation, attendance, and incidents — all of those FK to `exam_session_id`, not to individual `quiz_id`, because a room/seat/attendance record is about a student *sitting a specific quiz within a session*, requiring both IDs (`quiz_student_assignment` carries both).

---

## O. Multi-Subject Exam Model

**Who can combine quizzes into a session — recommended: Admin-only creates/finalizes the session; Faculty may *request* combination.**

Rationale (Problem → Solution → Alternatives → Trade-off):
- *Problem*: combining quizzes affects rooms, invigilators, and hundreds/thousands of students — a high blast-radius action.
- *Alternative 1*: Faculty combine freely. Rejected — no single faculty has visibility into room inventory or other faculty's schedules; creates uncoordinated double-bookings.
- *Alternative 2*: Admin combines, faculty has no input. Workable but loses faculty's scheduling preference signal.
- **Recommended**: Faculty submits a "scheduling preference" (preferred_date/time already on the quiz) and can flag "request to combine with X." Admin is the only actor with `POST /exam-sessions` and `PATCH .../quizzes` (add/remove) authority — this keeps the hard-conflict-checking logic centralized and auditable in one place instead of scattered across N faculty actions.

**Preconditions checked transactionally before a quiz can join a session:**
1. `quiz.status = 'APPROVED'`
2. Session time window compatible with quiz's approved duration
3. No student in the quiz's eligible roster already assigned elsewhere in an overlapping session (Conflict Engine, §Q)
4. No faculty (creator or requested invigilator) already committed to an overlapping session
5. Aggregate room capacity requirement is satisfiable (soft-checked here, hard-checked at room allocation)

---

## P. Student Assignment

```sql
quiz_student_assignment(
  id UUID PK,
  quiz_id UUID FK,
  exam_session_id UUID FK,
  student_id UUID FK,
  status TEXT,                -- ASSIGNED|WAITLISTED|CANCELLED
  assigned_at TIMESTAMPTZ,
  created_at, updated_at
)
UNIQUE (quiz_id, student_id)   -- a student can't be double-assigned to the same quiz
```
Generated by evaluating `student_subject_enrollment` against `quiz.subject_id/batch_id` at the point the quiz enters `ASSIGNING_STUDENTS`. Re-evaluated (diffed, not blindly regenerated) if enrollment changes before finalization — see Edge Cases #15–17.

---

## Q. Conflict Detection (Conflict Engine)

Centralized service, `ConflictEngine.check(context)`, called before every state transition that has cross-entity blast radius (session creation, quiz-to-session add, room allocation, invigilator assignment).

| Conflict type | Detection query | Class |
|---|---|---|
| Student overlap | Student has another `quiz_student_assignment` in an overlapping `exam_session` time window | HARD |
| Room double-book | Room already in `exam_session_rooms` for an overlapping time window | HARD |
| Faculty/invigilator overlap | Faculty in `exam_invigilators` for overlapping session | HARD |
| Capacity | Sum of assigned students > sum of allocated room capacity | HARD |
| Subject eligibility | Student assigned without matching `ENROLLED` enrollment | HARD |
| Batch mixing risk | Multiple batches of same subject combined | WARNING (informational) |
| Seating under-constrained | Room has only 1 subject, can't satisfy adjacency diversity | WARNING → falls back to spacing/randomization soft constraints |
| Admin override | Any WARNING can be force-accepted by Admin with a required `reason`, logged to audit | ADMIN_OVERRIDE |

**HARD conflicts abort the transaction (`SERIALIZABLE` or `SELECT ... FOR UPDATE` guarded) and return a structured error naming the conflicting rows.** WARNINGs are returned but don't block unless policy says otherwise; ADMIN_OVERRIDE requires an explicit second confirmation call carrying `override_reason`, itself audited.

---

## R. Room Management

```sql
rooms(
  id UUID PK,
  building TEXT,
  floor INT,
  room_number TEXT,
  capacity INT,
  rows INT,
  columns INT,
  status TEXT,              -- ACTIVE|MAINTENANCE|INACTIVE
  accessibility_info JSONB,  -- e.g. {"wheelchair_seats": ["A1","A2"]}
  created_at, updated_at
)
UNIQUE (building, room_number)

room_seats(
  id UUID PK,
  room_id UUID FK,
  seat_label TEXT,           -- 'A1'
  row_index INT,
  col_index INT,
  is_accessible BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,   -- can disable individual broken seats
  UNIQUE (room_id, seat_label)
)

room_availability(
  id UUID PK,
  room_id UUID FK,
  date DATE,
  start_time TIME,
  end_time TIME,
  reason TEXT,               -- 'MAINTENANCE' | 'RESERVED_OTHER_DEPT' | etc
  created_at
)
```
`room_seats` is materialized (not computed from rows×columns on the fly) so individual seats can be disabled, marked accessible, and directly referenced by `seating_assignments.seat_id` with a real foreign key.

---

## S. Room Allocation Algorithm

**Input:** exam_session_id, total student count (broken down by subject/batch), candidate rooms filtered by availability.

**Algorithm — Best-Fit Decreasing bin-packing** (not naive first-fit):
1. Query candidate rooms: `status='ACTIVE'` AND no `room_availability` block overlapping the session window AND no existing `exam_session_rooms` overlap (hard-checked with `SELECT ... FOR UPDATE` row locks on candidate rooms to prevent race — see §Concurrency).
2. Sort rooms by capacity descending.
3. Sort student groups (by subject) descending by size.
4. Best-Fit Decreasing: assign each group's students to the room leaving the least *remaining* capacity that still fits — minimizes room count and empty seats while respecting the "prefer same building" soft objective (tie-break by building proximity).
5. If total capacity insufficient → abort with a structured error listing shortfall (Edge Case #11) rather than partially allocating.
6. Persist to `exam_session_rooms` inside a single transaction; unique constraint `(room_id, date, time_window)` at the DB level is the final backstop against races.

**Complexity:** O(n log n) for sorting + O(n·m) worst case for bin-packing (n=students groups, m=rooms) — trivial at these scales (rooms are always a small set, hundreds not millions).

```sql
exam_session_rooms(
  id UUID PK,
  exam_session_id UUID FK,
  room_id UUID FK,
  allocated_capacity INT,
  created_at
)
UNIQUE (room_id, exam_session_id)
-- plus an EXCLUDE constraint (via btree_gist) preventing overlapping time windows per room across sessions
```

---

## T. Seating Architecture

**Seating is treated as a constraint-satisfaction / optimization problem, not sequential numbering**, per the requirement. Pipeline:

```
1. Load all quiz_student_assignment rows for the session, grouped by (room, subject, batch, quiz)
2. Load target room(s) seat maps (ordered by row, col — defines adjacency graph, not just "next seat")
3. Select strategy (SEQUENTIAL | ALTERNATE_SUBJECT | ALTERNATE_BATCH | SUBJECT_BATCH_MIX | RANDOMIZED | ANTI_CHEATING)
4. Build adjacency graph from seat grid (4-directional: left/right/front/back — configurable to include diagonals)
5. Run constraint solver (§U) to assign student → seat
6. Validate: walk every seat, check all HARD constraints hold
7. If HARD constraints violated → do not finalize; return violation report (§V)
8. If only SOFT constraints partially unsatisfied → finalize, but flag session with a "soft-constraint-score" and list unsatisfied instances for Admin visibility
9. Persist as immutable seating_plan + seating_assignments; any change after FINALIZED requires a new plan version, not an in-place edit
```

```sql
seating_plans(
  id UUID PK,
  exam_session_id UUID FK,
  room_id UUID FK,
  strategy TEXT,
  status TEXT,             -- DRAFT|VALIDATED|FINALIZED|SUPERSEDED
  soft_constraint_score NUMERIC,   -- 0-1, share of soft constraints satisfied
  version INT,
  generated_at, finalized_at
)
seating_assignments(
  id UUID PK,
  seating_plan_id UUID FK,
  student_id UUID FK,
  quiz_id UUID FK,
  seat_id UUID FK,
  created_at
)
UNIQUE (seating_plan_id, seat_id)     -- one student per seat, per plan (HARD constraint #1)
UNIQUE (seating_plan_id, student_id)  -- one seat per student, per plan
```

---

## U. Anti-Cheating Seating Algorithm

**Chosen approach: Greedy graph-coloring with backtrack-limited local repair**, not full CSP/backtracking search or ILP.

*Why not full backtracking/CSP solver:* at 10,000+ students the search space is enormous; exact CSP solving (or ILP) is not guaranteed to terminate in interactive time. *Why not pure random shuffle + hope:* gives no guarantee and no repair mechanism. *Why not simple round-robin (A,B,C,A,B,C...):* works well when group sizes are balanced but produces adjacency violations at row-wrap boundaries and can't incorporate multiple soft dimensions (subject + batch) simultaneously — needs a repair pass anyway, so we build the repair pass as the primary mechanism instead.

**Algorithm:**
1. Treat each seat as a graph node; edges connect physically adjacent seats (this is literally graph coloring: "colors" = subject/quiz/batch labels, goal = no two adjacent nodes share a color where avoidable).
2. **Greedy fill:** iterate seats in row-major order; for each seat, choose the next student from the pool whose (subject, batch, quiz) label differs from all *already-placed* adjacent seats, preferring the label with the most remaining unplaced students (keeps future flexibility — a welfare/degree heuristic borrowed from graph coloring).
3. If no student satisfies the hard "no duplicate seat" + soft "no same-label neighbor" simultaneously, place the least-bad option (fewest label collisions) and record the collision.
4. **Local repair pass:** after the greedy fill, scan for adjacency violations; attempt pairwise swaps between violating seats and non-adjacent same-condition seats elsewhere in the room to resolve them (bounded to K passes, e.g., K=3, to keep it O(n·K) rather than unbounded).
5. **Validate** (§V): count remaining soft violations; compute `soft_constraint_score = 1 - (violations / total_adjacent_pairs)`.
6. **Single-subject fallback**: when only one subject/quiz exists in a room, there is no label diversity to exploit — the engine falls back to alternating **batch**, then to a fixed **checkerboard empty-seat spacing** (every other seat empty) if capacity allows, then to pure randomization of student order as a last resort. This is called out explicitly to the Admin as reduced-effectiveness seating, never silently.

**Explicit disclaimer surfaced in the UI and API response:** *"Seating adjacency rules reduce opportunistic copying risk between neighbors; they are not a guarantee against all forms of cheating and must be combined with active invigilation."*

**Complexity:** O(n) greedy fill + O(n·K) repair ≈ O(n) for fixed K — scales linearly, tested comfortably to 100K+ (partitioned per-room, so real per-run n is bounded by room capacity, typically ≤ a few hundred, run in parallel across rooms).

---

## V. Seating Constraint Engine

**Hard constraints** (violation ⇒ plan cannot be FINALIZED, must be blocked and reported):
- One student per seat.
- One seat per student.
- No inactive/disabled seat used.
- Accessibility-required students placed only in accessible seats.
- Explicit student-pair separation rules (e.g., known prior incident between two students) never violated.

**Soft constraints** (violation ⇒ plan can finalize, but is scored and reported):
- Adjacent seats prefer different subject.
- Adjacent seats prefer different batch.
- Adjacent seats prefer different quiz.
- Prefer spacing/empty seats when capacity allows.

**On failure to fully satisfy:** the seating result carries a structured report:
```json
{
  "status": "FINALIZED_WITH_WARNINGS",
  "hard_violations": [],
  "soft_violations": [
    {"seat_a": "B12", "seat_b": "B13", "constraint": "SUBJECT_DIVERSITY", "reason": "Only one subject present in room 204"}
  ],
  "alternatives_suggested": ["Split room 204 into two rooms", "Add a second subject cohort to room 204"]
}
```
If a **hard** constraint cannot be satisfied (e.g., more accessibility-required students than accessible seats), the engine returns `status: "FAILED"` with the specific unsatisfiable constraint and affected student/room IDs — **the plan is never silently finalized** in that state.

---

## W. Invigilation

```sql
exam_invigilators(
  id UUID PK,
  exam_session_id UUID FK,
  room_id UUID FK,
  faculty_id UUID FK,
  role TEXT,               -- LEAD_INVIGILATOR|ASSISTANT_INVIGILATOR
  assigned_at, created_at
)
UNIQUE (exam_session_id, room_id, faculty_id)
```
A faculty member may invigilate any room regardless of subject taught. Overlap prevention: before insert, check no other `exam_invigilators` row for the same faculty has an overlapping `exam_sessions` time window (same Conflict Engine pattern as room allocation — `SELECT ... FOR UPDATE` on the faculty's existing assignments).

---

## X. Attendance Architecture

```sql
attendance(
  id UUID PK,
  quiz_student_assignment_id UUID FK,     -- ties to student+quiz+session together
  seat_id UUID FK,
  status TEXT,              -- PRESENT|ABSENT|LATE|EXCUSED|MEDICAL|OTHER
  method TEXT,               -- MANUAL|SEAT_BASED|QR|BIOMETRIC(reserved)
  marked_by_faculty_id UUID FK,
  marked_at TIMESTAMPTZ,
  locked BOOLEAN DEFAULT FALSE,
  created_at, updated_at
)
UNIQUE (quiz_student_assignment_id)   -- prevents duplicate attendance per student per quiz

attendance_history(
  id UUID PK,
  attendance_id UUID FK,
  changed_by_faculty_id UUID FK,
  old_status TEXT,
  new_status TEXT,
  reason TEXT,               -- required for any post-lock change
  changed_at TIMESTAMPTZ
)
```
**Validation before insert (server-side):** `quiz_student_assignment` must exist and have `status='ASSIGNED'`; `exam_session.status` must be `IN_PROGRESS` (not cancelled/not-yet-started/already-completed for normal flow); `seat_id` must match the student's `seating_assignments` row for that plan.

---

## Y. Attendance Workflow

1. Session transitions to `IN_PROGRESS` → attendance rows are eligible for creation (pre-created as `status=NULL`/pending is an option, or created on first mark — we choose **lazy creation on first mark** to avoid pre-writing rows for no-shows unnecessarily, though either works; lazy chosen for lower write volume at scale).
2. Faculty marks via one of three methods (see §Attendance Methods below).
3. On `exam_session.status → COMPLETED`, a batch job sets `attendance.locked = true` for all rows in that session.
4. Post-lock change requires `reason` (NOT NULL enforced by CHECK when `locked=true` requires a paired `attendance_history` insert — enforced via application transaction: update + history insert atomically, or reject).

**Attendance methods comparison:**
| Method | Pros | Cons | Recommendation |
|---|---|---|---|
| Manual | Simplest, no dependencies | Slow at scale, error-prone | Fallback always available |
| Seat-based | Visual, matches physical layout, fast | Needs seating plan loaded on device | **Recommended initial default** — best correctness/speed trade-off |
| QR | Fast, self-service reduces faculty load | Needs device/connectivity in every room, spoofing risk if not paired with seat check | Phase 2 addition, validated against seat assignment (QR only marks present if scanned at the *assigned* seat's session) |
| Biometric | Strongest identity guarantee | Cost, privacy/compliance burden, hardware rollout | Architecture reserves `method` enum value only — not implemented |

---

## Z. Incident Management

```sql
incidents(
  id UUID PK,
  exam_session_id UUID FK,
  quiz_id UUID FK NULL,
  student_id UUID FK NULL,
  room_id UUID FK NULL,
  seat_id UUID FK NULL,
  reported_by_faculty_id UUID FK,
  incident_type TEXT,        -- CHEATING_SUSPICION|UNAUTHORIZED_MATERIAL|MISCONDUCT|MISSING|LATE|MEDICAL|SEATING|TECHNICAL|ROOM|IDENTITY|PAPER|OTHER
  severity TEXT,              -- LOW|MEDIUM|HIGH|CRITICAL
  description TEXT,
  evidence_metadata JSONB,    -- pointers to object storage, not raw files
  status TEXT,                -- OPEN|UNDER_REVIEW|RESOLVED|DISMISSED|ESCALATED
  resolution TEXT NULL,
  resolved_by_admin_id UUID FK NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at, updated_at
)
incident_history(
  id UUID PK, incident_id UUID FK, actor_id UUID FK,
  action TEXT, old_status TEXT, new_status TEXT, notes TEXT, created_at
)
```

---

## AA. Incident Workflow

```
Faculty reports incident (status=OPEN)
  → Admin reviews
      → INVESTIGATE (status=UNDER_REVIEW)
      → REQUEST_MORE_INFO (stays UNDER_REVIEW, notifies reporter)
      → ESCALATE (status=ESCALATED, e.g. CRITICAL severity auto-suggests escalation)
      → RESOLVE (status=RESOLVED, resolution required)
      → DISMISS (status=DISMISSED, resolution required)
```
**Escalation rule:** severity=CRITICAL auto-notifies Admin immediately (bypasses batch notification queue — see §Notification priority lanes) regardless of status; severity is set by the reporter but can be revised by Admin during review (each revision is a history row).

**Incident ↔ Attendance:** related, never auto-coupled. An incident referencing a student does not automatically change their `attendance.status` — a human (Admin or Faculty, per role) must explicitly update attendance separately, with its own audited reason. This preserves intentionality (Edge Case: a "late arrival" incident might correlate with `LATE` attendance, but a "cheating suspicion" incident should never silently flip attendance).

**Student visibility rule:** students see attendance and their own exam schedule but **never** incident records, regardless of whether the incident references them, unless/until Admin explicitly discloses via a separate, deliberate "notify student" action (not built by default — flagged as an unresolved business decision: does policy require disclosure to the accused student, and when?).

---

## AB. Notification Architecture

```
App event (quiz approved, seat assigned, exam cancelled, etc.)
   → notification_outbox row written in the SAME transaction as the domain change (transactional outbox pattern)
   → background dispatcher polls/streams outbox → publishes to queue (SQS/Redis Streams)
   → worker pool consumes → renders template → sends via provider (email/in-app/push)
   → delivery result written back (SENT|FAILED|RETRYING) with attempt count
   → exhausted retries → dead-letter queue → alert
```

```sql
notifications(
  id UUID PK,
  recipient_type TEXT,          -- STUDENT|FACULTY
  recipient_id UUID,
  event_type TEXT,               -- QUIZ_APPROVED|SEAT_ASSIGNED|EXAM_CANCELLED|...
  channel TEXT,                  -- IN_APP|EMAIL|PUSH
  payload JSONB,
  status TEXT,                   -- PENDING|SENT|FAILED|DEAD_LETTER
  idempotency_key TEXT NOT NULL, -- e.g. hash(event_type, recipient_id, entity_id, entity_version)
  attempt_count INT DEFAULT 0,
  last_error TEXT NULL,
  created_at, sent_at
)
UNIQUE (idempotency_key)   -- guarantees exactly-once delivery intent even under redelivery
```
**Why transactional outbox, not "just publish to the queue in the request handler":** if the DB commit succeeds but the queue publish fails (network blip), a naive approach silently drops the notification. The outbox row is committed atomically with the domain change; a separate relay guarantees eventual publish (at-least-once), and `idempotency_key` makes redelivery safe (at-least-once + idempotent consumer = effectively-once).

**Retry policy:** exponential backoff (1m, 5m, 30m, 2h, 12h), 5 attempts, then dead-letter with alert to Admin ops channel.

---

## AC/AD. Database Schema & ER Diagram

Full DDL sketch (PostgreSQL). All tables have `created_at`, `updated_at`; soft-delete via `status`/`is_active` columns rather than physical delete on any table with historical/audit significance (departments, subjects, rooms, students, faculty). Purely transactional/log tables (`audit_logs`, `notifications`, `*_history`) are append-only and never updated or deleted.

```sql
-- Identity & RBAC
users(id UUID PK, email TEXT UNIQUE, password_hash TEXT, is_active BOOLEAN, created_at, updated_at)
roles(id UUID PK, name TEXT UNIQUE)                       -- ADMIN, FACULTY, STUDENT, INVIGILATOR(logical, not separate person)
user_roles(user_id FK, role_id FK, PRIMARY KEY(user_id, role_id))
permissions(id UUID PK, code TEXT UNIQUE)                  -- resource:action granularity
role_permissions(role_id FK, permission_id FK, PRIMARY KEY(role_id, permission_id))

-- Academic structure
departments(id PK, name, code UNIQUE, status, metadata JSONB, created_at, updated_at)
programs(id PK, department_id FK, name, code UNIQUE, status, created_at, updated_at)
batches(id PK, program_id FK, year INT, section TEXT, status, UNIQUE(program_id, year, section))
subjects(id PK, department_id FK, program_id FK NULL, code UNIQUE, name, credits, is_active)

-- People
students(id PK, user_id FK UNIQUE, program_id FK, batch_id FK, roll_number UNIQUE, status, created_at, updated_at)
faculty(id PK, user_id FK UNIQUE, department_id FK, employee_code UNIQUE, status, created_at, updated_at)

-- The critical M:N cores
faculty_subject_batch_assignment(
  id PK, faculty_id FK, subject_id FK, batch_id FK,
  academic_year TEXT, semester INT, role TEXT,   -- PRIMARY_INSTRUCTOR|CO_INSTRUCTOR
  UNIQUE(faculty_id, subject_id, batch_id, academic_year, semester)
)
student_subject_enrollment(
  id PK, student_id FK, subject_id FK, batch_id FK,
  academic_year TEXT, semester INT, status TEXT,
  enrolled_at, dropped_at NULL,
  UNIQUE(student_id, subject_id, academic_year, semester)
)

-- Quiz
quizzes(id PK, title, subject_id FK, created_by_faculty_id FK, duration_minutes, total_marks,
        question_count, instructions, quiz_type, preferred_date, preferred_time,
        academic_year, semester, status, version INT, created_at, updated_at)
quiz_batches(quiz_id FK, batch_id FK, PRIMARY KEY(quiz_id, batch_id))
quiz_approval_history(id PK, quiz_id FK, action, actor_id FK, reason NULL, previous_status, new_status, created_at)

-- Exam session
exam_sessions(id PK, name, session_date, start_time, end_time, status, created_by_admin_id FK, version INT, created_at, updated_at)
exam_session_quizzes(exam_session_id FK, quiz_id FK, PRIMARY KEY(exam_session_id, quiz_id))
quiz_student_assignment(id PK, quiz_id FK, exam_session_id FK, student_id FK, status, assigned_at,
                         UNIQUE(quiz_id, student_id))

-- Rooms & allocation
rooms(id PK, building, floor, room_number, capacity, rows, columns, status, accessibility_info JSONB,
      UNIQUE(building, room_number))
room_seats(id PK, room_id FK, seat_label, row_index, col_index, is_accessible, is_active,
           UNIQUE(room_id, seat_label))
room_availability(id PK, room_id FK, date, start_time, end_time, reason, created_at)
exam_session_rooms(id PK, exam_session_id FK, room_id FK, allocated_capacity, created_at,
                    UNIQUE(room_id, exam_session_id))

-- Seating
seating_plans(id PK, exam_session_id FK, room_id FK, strategy, status, soft_constraint_score,
              version INT, generated_at, finalized_at)
seating_assignments(id PK, seating_plan_id FK, student_id FK, quiz_id FK, seat_id FK, created_at,
                     UNIQUE(seating_plan_id, seat_id), UNIQUE(seating_plan_id, student_id))

-- Invigilation
exam_invigilators(id PK, exam_session_id FK, room_id FK, faculty_id FK, role, assigned_at, created_at,
                   UNIQUE(exam_session_id, room_id, faculty_id))

-- Attendance
attendance(id PK, quiz_student_assignment_id FK UNIQUE, seat_id FK, status, method,
           marked_by_faculty_id FK, marked_at, locked BOOLEAN, created_at, updated_at)
attendance_history(id PK, attendance_id FK, changed_by_faculty_id FK, old_status, new_status, reason, changed_at)

-- Incidents
incidents(id PK, exam_session_id FK, quiz_id FK NULL, student_id FK NULL, room_id FK NULL, seat_id FK NULL,
          reported_by_faculty_id FK, incident_type, severity, description, evidence_metadata JSONB,
          status, resolution NULL, resolved_by_admin_id FK NULL, resolved_at NULL, created_at, updated_at)
incident_history(id PK, incident_id FK, actor_id FK, action, old_status, new_status, notes, created_at)

-- Notifications
notifications(id PK, recipient_type, recipient_id, event_type, channel, payload JSONB, status,
              idempotency_key UNIQUE, attempt_count, last_error, created_at, sent_at)

-- Audit
audit_logs(id PK, actor_id FK, action TEXT, entity_type TEXT, entity_id UUID, old_value JSONB,
           new_value JSONB, reason TEXT NULL, request_id UUID, created_at)
```

**Key indexes** (beyond PK/unique): `student_subject_enrollment(student_id, status)`, `quiz_student_assignment(student_id)`, `attendance(quiz_student_assignment_id)`, `exam_sessions(session_date, start_time, end_time)` (GiST for range overlap via `btree_gist`), `seating_assignments(student_id)`, `audit_logs(entity_type, entity_id, created_at)`.

**ER Diagram (textual):**
```
department ─┬─< program ─< batch ─< student >─┬─< student_subject_enrollment >─┤
            └─< subject <┤                    │
faculty >──< faculty_subject_batch_assignment >──┤ subject, batch
faculty ──< quiz (created_by) ──< quiz_batches >── batch
quiz ──< quiz_approval_history
quiz >──< exam_session_quizzes >── exam_session
quiz ──< quiz_student_assignment >── student, exam_session
exam_session >──< exam_session_rooms >── room ──< room_seats
exam_session >──< exam_invigilators >── faculty
seating_plan(exam_session, room) ──< seating_assignments >── student, seat, quiz
quiz_student_assignment ──(1:1)── attendance ──< attendance_history
exam_session ──< incidents >── student, room, seat, faculty
* ──< audit_logs, notifications
```

---

## AD-2. State Machines

Dedicated state machine specs for the seven stateful entities. Format: States → Transitions (who can trigger) → Preconditions → Side effects → Failure behavior → Audit.

### 1. Quiz
**States**: `DRAFT → SUBMITTED → APPROVED | REJECTED`; `REJECTED → SUBMITTED` (resubmit, if DEC-011 in OPEN_DECISIONS.md confirms it's allowed); `APPROVED → DRAFT` (on substantive edit, BR-015).
| Transition | Trigger | Precondition | Side effect | Failure |
|---|---|---|---|---|
| DRAFT→SUBMITTED | Faculty (owner) | all required fields present; faculty still authorized for subject/batch | `quiz_approval_history` row (SUBMITTED); notification to Admin queue | 422 incomplete, 403 unauthorized |
| SUBMITTED→APPROVED | Admin | quiz still at submitted `version` | history row; notification to faculty; quiz now attachable to sessions | 409 stale version (EC-047) |
| SUBMITTED→REJECTED | Admin | `reason` provided (BR-012) | history row w/ reason; notification to faculty | 422 missing reason |
| REJECTED→SUBMITTED | Faculty (owner) | edits made | new history row | — |
| APPROVED→DRAFT | System (triggered by faculty edit of substantive field) | edit touches subject/batch/duration/marks | history row noting auto-revert; Admin notified re-approval needed | — |
Audit: every transition is a `quiz_approval_history` row (BR-013) plus a generic `audit_logs` entry (BR-048).

### 2. Exam Session
**States**: `DRAFT → ASSIGNING_STUDENTS → ROOM_ALLOCATION → SEATING_GENERATION → READY_FOR_FINALIZATION → FINALIZED → NOTIFIED → IN_PROGRESS → COMPLETED`; any pre-`IN_PROGRESS` state → `CANCELLED`.
| Transition | Trigger | Precondition | Side effect | Failure |
|---|---|---|---|---|
| DRAFT→ASSIGNING_STUDENTS | Admin (attach ≥1 quiz) | all attached quizzes APPROVED; Conflict Engine passes (no HARD conflicts) | `quiz_student_assignment` generation job queued | 409 HARD conflict list |
| ASSIGNING_STUDENTS→ROOM_ALLOCATION | Admin | assignment job complete | — | — |
| ROOM_ALLOCATION→SEATING_GENERATION | Admin | rooms allocated, capacity sufficient | — | 409 capacity shortfall |
| SEATING_GENERATION→READY_FOR_FINALIZATION | System (job complete) | all room seating plans VALIDATED (no HARD violations) | — | plan(s) stay DRAFT/FAILED, session stuck here until resolved |
| READY_FOR_FINALIZATION→FINALIZED | Admin | explicit confirm | all seating plans → FINALIZED; audit snapshot taken | — |
| FINALIZED→NOTIFIED | System | notification fan-out job complete | — | partial failures tracked per-notification, doesn't block session state |
| NOTIFIED→IN_PROGRESS | Admin or scheduled trigger at `start_time` | — | attendance becomes eligible for creation | — |
| IN_PROGRESS→COMPLETED | Admin or scheduled trigger at `end_time` | — | attendance auto-locks (BR-034) | — |
| any (pre-IN_PROGRESS)→CANCELLED | Admin | `reason` required | cascades logical-inactive to children; cancellation notifications | — |
Audit: every transition logged; CANCELLED reason mandatory and audited (BR-048).

### 3. Room Allocation (per exam_session_rooms row, sub-state of session)
**States**: `PROPOSED → CONFIRMED | REJECTED_CAPACITY | REJECTED_CONFLICT`.
Trigger: Admin via allocation endpoint. Precondition: room ACTIVE, no `room_availability` block, no existing overlapping `exam_session_rooms` (row-locked check). Side effect on CONFIRMED: row inserted with exclusion constraint as final backstop. Failure: 409 with conflict detail; row never persisted on failure (no PROPOSED state is durably stored — it's a request-scoped concept, not a DB row, to avoid needing cleanup of abandoned proposals).

### 4. Seating Plan
**States**: `DRAFT → VALIDATED | FAILED`; `VALIDATED → FINALIZED`; `FINALIZED → SUPERSEDED` (on re-plan).
| Transition | Trigger | Precondition | Side effect | Failure |
|---|---|---|---|---|
| (none)→DRAFT | Admin (generate) | idempotency key unique for (session, room) in DRAFT/FINALIZED | seating job queued | 409 duplicate request (EC-032) |
| DRAFT→VALIDATED | System (job) | zero HARD constraint violations | soft_constraint_score computed | — |
| DRAFT→FAILED | System (job) | HARD constraint unsatisfiable | violation report generated (§V) | plan never reaches FINALIZED |
| VALIDATED→FINALIZED | Admin | explicit confirm | assignments become immutable except via versioned re-plan | 409 if HARD violations somehow reappear (race) |
| FINALIZED→SUPERSEDED | Admin (triggers re-plan, e.g. EC-015/EC-022) | — | new plan version created; old retained for history, never deleted | — |
Audit: generation, validation result, finalize, and supersede all logged (BR-048); FAILED state and its violation report are logged, not just returned transiently.

### 5. Attendance
**States**: `(none) → PRESENT | ABSENT | LATE | EXCUSED | MEDICAL | OTHER`, then `→ LOCKED` (implicit flag, not a separate status value — `locked` boolean), then modifiable only via authorized-change path.
Trigger for creation: Faculty/Invigilator-of-record. Precondition: `quiz_student_assignment.status=ASSIGNED`, `exam_session.status=IN_PROGRESS` (BR-032). Side effect: `attendance` row created (lazy, on first mark). Failure: 409 duplicate (BR-033), 422 session not in progress.
Lock trigger: System, on `exam_session→COMPLETED`. Post-lock modification: Faculty/Admin, requires `reason`, creates `attendance_history` row (BR-035); 423 if reason omitted.
Audit: every status set and every post-lock change logged.

### 6. Incident
**States**: `OPEN → UNDER_REVIEW → RESOLVED | DISMISSED | ESCALATED`; `ESCALATED → UNDER_REVIEW` (re-review possible) `→ RESOLVED | DISMISSED`.
Trigger: creation by Faculty/Invigilator (OPEN); all further transitions by Admin. Precondition for RESOLVED/DISMISSED: `resolution` text required. Side effect: CRITICAL severity or ESCALATED status triggers immediate (non-batched) Admin notification (BR-038). Failure: 422 if resolution missing on RESOLVED/DISMISSED; invalid transition (e.g., RESOLVED→OPEN) rejected outright — no "reopen" path exists by design (file a new incident instead, per EC-031's pattern).
Audit: every transition → `incident_history` row (BR-039).

### 7. Notification
**States**: `PENDING → SENT | FAILED (→ RETRYING → SENT | FAILED...) → DEAD_LETTER`.
Trigger: System, on outbox row creation (same transaction as the domain event, BR-042). Precondition for SENT: provider accepts delivery. Side effect of FAILED: backoff-scheduled retry (attempt_count incremented). Side effect of exhausted retries: `DEAD_LETTER` + ops alert (BR-044). Failure is never silent — every FAILED/DEAD_LETTER state is queryable and alerting-visible, never just dropped.
Audit: delivery attempts and final status tracked on the `notifications` row itself (attempt_count, last_error, sent_at) — this row IS the audit trail for this entity, no separate history table needed since notifications aren't mutated by humans.

---

## AE. API Design

REST, versioned (`/api/v1`), JSON, bearer-token auth. Representative endpoints (pattern repeats across modules):

| Module | Method/Endpoint | Notes |
|---|---|---|
| Auth | `POST /auth/login` | rate-limited, returns JWT + refresh token |
| Academic | `POST /departments`, `GET /departments?status=ACTIVE&cursor=` | Admin only; cursor pagination |
| Enrollment | `POST /enrollments` | Admin/Faculty; body `{student_id, subject_id, batch_id, academic_year, semester}`; 409 on duplicate (unique violation mapped to friendly error) |
| Assignment | `POST /faculty-assignments` | Admin; validates department consistency |
| Quiz | `POST /quizzes` (DRAFT) → `POST /quizzes/{id}/submit` → `POST /quizzes/{id}/approve` \| `/reject` | Faculty creates/submits; Admin approves/rejects; `reject` requires `reason` in body (400 if missing); optimistic lock via `If-Match: version` header, 409 on stale write |
| Exam Session | `POST /exam-sessions` `PATCH /exam-sessions/{id}/quizzes` | Admin only; runs Conflict Engine synchronously, returns 409 with structured conflict list on HARD conflict |
| Room Allocation | `POST /exam-sessions/{id}/rooms/allocate` | Admin; triggers allocation algorithm synchronously (fast, bounded room count) |
| Seating | `POST /exam-sessions/{id}/seating/generate` | Admin; **async** — returns 202 + job id; poll `GET /seating-jobs/{id}` or receive webhook/notification; idempotency key required in header to prevent duplicate generation (Edge Case #32) |
| Attendance | `POST /exam-sessions/{id}/attendance` | Faculty/Invigilator; body `{student_id, status, method}`; validates assignment+session state; 409 on duplicate; `PATCH .../attendance/{id}` for post-lock change requires `reason`, 423 Locked if reason missing |
| Incidents | `POST /incidents`, `PATCH /incidents/{id}/status` | Faculty creates; Admin transitions; full history returned on GET |
| Notifications | `GET /me/notifications?cursor=` | Student/Faculty own inbox only (resource-scoped) |
| Reports | `GET /reports/attendance?exam_session_id=&format=csv` | Async for large exports — returns 202 + signed download URL delivered via notification when ready |
| Audit | `GET /audit-logs?entity_type=&entity_id=` | Admin only |

**Idempotency:** every POST that creates a side-effecting resource (quiz submission, seating generation, notification dispatch, bulk import) accepts an `Idempotency-Key` header; server stores `(key, response)` for 24h and replays the stored response on retry instead of re-executing.

**Error model:** consistent envelope `{error: {code, message, details: [...]}}`; HARD conflicts return `409` with `details` listing each conflicting entity; validation errors `422`.

---

## AF. Authorization

RBAC + resource-level checks, evaluated server-side on every request (never trust a client-supplied role claim beyond identity — role/permission is re-fetched from DB or a short-TTL cache, not solely from a long-lived JWT claim, to allow immediate revocation).

**Resource-level rules (non-exhaustive, representative):**
- Faculty can only `GET/PATCH` a quiz where `quiz.created_by_faculty_id = current_faculty.id` OR they hold a `CO_INSTRUCTOR` assignment on it.
- Faculty **cannot** approve their own quiz — approval endpoint requires `role=ADMIN`, full stop (no self-approval path exists, not just discouraged).
- Student can only `GET /students/{id}/...` where `id = current_student.id`.
- Student cannot access `POST/PATCH` on seating, attendance, or incidents — those routes require `role IN (ADMIN, FACULTY, INVIGILATOR-context)`.
- Faculty can only mark attendance for `exam_invigilators` rows where they are assigned to that room/session, OR they are the quiz's instructor of record — configurable policy, default: **invigilator-of-record only**, to keep the audit trail meaningful.

---

## AG. Security

- Password hashing: Argon2id (or bcrypt cost≥12) — never reversible encryption.
- Transport: TLS everywhere; HSTS.
- JWT access tokens short-lived (15 min) + rotating refresh tokens; refresh revocation list in Redis.
- Rate limiting on auth and bulk endpoints (token bucket, per-user + per-IP).
- Input validation at API boundary (schema validation, e.g. Zod/Pydantic) *and* re-validated in the service layer — never rely on frontend validation for integrity rules (explicit requirement).
- File/evidence uploads (incident evidence) go to object storage via pre-signed URLs, virus-scanned on upload, never stored inline in the DB.
- SQL access exclusively through parameterized queries/ORM — no string-concatenated SQL.
- Secrets in a managed secret store (not env files in repo).
- PII minimization: incident evidence and attendance history retained per a defined retention policy (**unresolved — confirm institutional data retention requirement**, e.g. 3 years post-graduation).

---

## AH/AI. Concurrency & Transactions

| Scenario | Mechanism |
|---|---|
| Two faculty pick the same room simultaneously | `SELECT ... FOR UPDATE` on candidate room rows during allocation, inside a single transaction; loser gets 409 with current room state |
| Two seating-generation requests for same session | Idempotency key + `seating_plans` row created with `status=DRAFT` first under a unique partial index `(exam_session_id, room_id) WHERE status IN ('DRAFT','FINALIZED')` — second request finds existing DRAFT/FINALIZED and returns it instead of regenerating |
| Admin approves while faculty edits | Optimistic locking via `version` column; faculty's stale `PATCH` (submitted with old version) gets 409, must refetch |
| 10,000 students notified simultaneously | Not a DB transaction concern — writes fan out to `notifications` outbox in a single bulk insert, then queue workers process independently; no single long transaction |
| Two faculty assign the same student to different quizzes at conflicting times | Unique constraint `(quiz_id, student_id)` prevents same-quiz duplication; cross-quiz *time* conflict caught by Conflict Engine inside the session-assembly transaction, `SERIALIZABLE` isolation for that specific check-then-insert sequence |
| Isolation level | `READ COMMITTED` default for normal reads/writes; escalate to `SERIALIZABLE` (or explicit row locks) only for the specific booking/allocation/seating-finalization transactions where check-then-act races matter |

**Idempotency keys** are the general-purpose defense for "duplicate API request" (Edge Case #45) across all side-effecting endpoints, not just seating.

---

## AJ. Audit Logging

Every state-changing action writes one `audit_logs` row: `actor_id, action, entity_type, entity_id, old_value (JSONB snapshot), new_value (JSONB snapshot), reason, request_id, created_at`. Written in the **same transaction** as the domain change (never a best-effort side call) so audit history can never silently drop out of sync with reality. `request_id` (propagated from an `X-Request-Id` header) ties a whole request's audit rows together for tracing.

---

## AK/AL/AM/AN. Scalability, Performance, Caching, Queueing

**Stage-by-stage:**

| Scale | Architecture |
|---|---|
| 10K students | Single Postgres primary + 1 read replica, single app instance cluster (2-3 nodes) behind a load balancer, Redis for cache/session/rate-limit, one queue (SQS or Redis Streams) with a small worker pool. Fully sufficient. |
| 50K students | Add read replicas for dashboard/report queries, connection pooling (PgBouncer), scale app nodes horizontally (stateless — trivial), scale worker pool count, introduce CDN for static assets, add caching layer for hot reads (room/seat maps, dashboards) with short TTL + explicit invalidation on write. |
| 100K+ students | Continue horizontal scaling of stateless app/workers; partition heavy tables by `academic_year` (range partitioning, not sharding) for `attendance`, `audit_logs`, `notifications` — keeps indexes small and archival easy without distributing the database. Sharding is **explicitly not recommended** at this stage — Postgres with partitioning and read replicas comfortably handles 100K+ students' worth of relational data (this is low-hundreds-of-GB territory, not petabyte). Revisit sharding only if a single logical database becomes the write bottleneck, which is unlikely given exam events are bursty but bounded in write volume even at 100K. |

**Caching strategy:** cache read-heavy, low-churn data (room layouts, published seating plans, a student's own upcoming-exam view) in Redis with short TTL + write-through invalidation on the triggering mutation. Never cache attendance-in-progress or anything actively being written during an exam window.

**Performance targets (p95):**
| Operation | Target | Sync/Async |
|---|---|---|
| Dashboard load | <300ms | Sync (cached) |
| Quiz create/submit | <400ms | Sync |
| Approval action | <300ms | Sync |
| Conflict detection | <500ms | Sync |
| Room allocation | <1s | Sync (bounded room count) |
| Seating generation (per room) | <2s per room, parallelized across rooms | **Async**, job-based |
| Attendance mark | <200ms | Sync |
| Notification dispatch | n/a to caller | **Async**, fire-and-forget from caller's perspective |
| Reports/exports | n/a to caller | **Async**, generated in background, delivered via signed URL + notification |

**Queue architecture:** single logical queue system (SQS or Redis Streams — see tech stack) with **priority lanes**: `critical` (CRITICAL incidents, session cancellations) processed by a dedicated small worker pool with tighter polling, `standard` (routine notifications, exports) processed by the main pool. Dead-letter queue per lane, alerting on DLQ depth > 0.

---

## AO. Failure Recovery

| Failure | Behavior |
|---|---|
| Database crashes | App returns 503 via health-check-gated LB; on recovery, no partial writes exist because every multi-step domain change is one transaction; clients retry idempotently |
| Redis crashes | Cache misses fall through to Postgres (degraded latency, not degraded correctness); rate-limiting fails open or closed per policy (recommend fail-closed for auth, fail-open for read caching) |
| Queue crashes | Outbox rows remain `PENDING` in Postgres (source of truth survives); relay resumes publishing once queue recovers — no data loss, just delay |
| Notification provider crashes | Retries with backoff; after exhaustion, DLQ + alert; in-app notifications still show (DB write already committed independent of external provider) |
| Seating engine crashes mid-run | Job marked `FAILED`, `seating_plans` row never reaches `FINALIZED` (partial state never exposed as truth); safe to re-trigger with same idempotency key |
| App server crashes | Stateless — LB routes around it; in-flight request fails, client retries (idempotent by design for all mutating calls) |
| User retries a request | Idempotency key returns the original result, no duplicate side effect |
| Worker executes same job twice | Idempotent job handlers (upsert semantics, or idempotency-key-guarded) make double execution a no-op |
| Network partial failure mid-transaction | DB transaction guarantees atomicity — either fully committed or fully rolled back, no partial state |

---

## AP. Observability

- **Logs**: structured JSON, correlated by `request_id`, shipped to a log aggregator.
- **Metrics**: API latency (p50/p95/p99) per route, DB query latency, queue depth per lane, worker success/failure rate, seating-generation duration, notification delivery success rate, room utilization %, active session count, active WebSocket/dashboard connections.
- **Tracing**: distributed trace per request across app → DB/queue/worker boundaries (OpenTelemetry).
- **Alerts**: DLQ depth > 0, p95 API latency breach, DB replica lag > threshold, worker failure rate spike, any HARD conflict resolution failure, disk/connection-pool saturation.

---

## AQ. UI/UX

Representative screens (full field/action/permission matrix is large — summarized per role; expand per-screen in a design-phase doc):

**Admin:** Dashboard (KPI tiles: pending approvals, active sessions, open incidents) · Approval Queue (list+filter, approve/reject with reason modal) · Exam Session builder (multi-select approved quizzes, conflict panel shown inline before save) · Room Management (CRUD + seat-map editor) · Seating Plan viewer (visual grid, violation highlights) · Attendance overview · Incident triage board (Kanban by status) · Reports (async export with progress) · Audit Log viewer (filterable, read-only).

**Faculty:** Dashboard (my quizzes by status, upcoming invigilation) · Create Quiz (subject/batch dropdown scoped to their assignments only) · Student roster (per subject/batch) · Attendance (seat-map click-to-mark) · Incident report form.

**Student:** Dashboard (upcoming exams card list: subject, date, time, room, seat, instructions) · Exam detail · Notifications inbox · Attendance history (read-only) · Past exams.

Every list screen: pagination (cursor-based), search, relevant filters, loading skeleton, empty state with guidance text, error state with retry, and a confirmation dialog on every destructive/high-blast-radius action (reject quiz, cancel session, finalize seating, delete room).

---

## AR. End-to-End User Journey

**Setup:** 3 subjects (DBMS/Faculty A, OS/Faculty B, CN/Faculty C), 100 students with overlapping enrollments (e.g., Student #42 enrolled in DBMS + OS + Mathematics).

1. Faculty A creates `DBMS-QUIZ-4` (DRAFT) → submits → Admin approves.
2. Faculty B, C do the same for their quizzes → both approved.
3. Admin creates `EXAM SESSION #1001`, 20-Sep 10:00–11:00, adds all three quizzes. Conflict Engine passes (no student/room/faculty overlap found).
4. System evaluates enrollment → generates `quiz_student_assignment` rows (e.g., 40 DBMS, 35 OS, 25 CN — some students appear in only one, none in more than one of these three since each is a distinct subject a student takes at most once).
5. Admin allocates rooms: Room 101 (60 seats), Room 102 (50 seats) — Best-Fit Decreasing splits the 100 students across two rooms respecting capacity.
6. Admin triggers seating generation → async job → greedy + repair produces an alternating DBMS/OS/CN pattern per room, validated, `soft_constraint_score = 0.94` (a few unavoidable same-subject adjacencies at row boundaries, reported).
7. Session finalized → notifications queued → students see room/seat, faculty see roster + invigilation duty.
8. Exam day: Faculty A invigilates Room 101 (even though CN is also in that room — cross-subject invigilation, supported).
   - Student #42 (DBMS, seat B12) arrives late → marked `LATE`, with an accompanying "Late arrival" incident (LOW severity), not auto-linked beyond the shared `student_id`+`exam_session_id`.
   - Student #17 (OS, seat B13) is suspected of copying from neighbor → Faculty A reports incident: `CHEATING_SUSPICION`, severity `HIGH`, description filed, evidence metadata attached (photo reference in object storage).
9. Session ends → status `COMPLETED` → attendance auto-locks.
10. Admin reviews incident: `UNDER_REVIEW` → investigates → `RESOLVED` with resolution note "Verbal warning issued, no material found."
11. Reports: Admin exports attendance CSV + incident report (async, delivered via signed URL notification).
12. Audit log shows the full chain: quiz creation → approval → session creation → room allocation → seating finalization → attendance marks → incident lifecycle — each with actor, timestamp, old/new value.

---

## AS. Real-World Edge Cases (selected — full 50 follow the same template)

*(Format: Business behavior → Backend/DB behavior → Recovery)*

**#7 Different batches of same subject combined:** Business: allowed, common (e.g., DBMS for Batch A and Batch B in one session). Backend: `quiz_batches` already supports M:N per quiz; Conflict Engine treats batch as a seating-diversity dimension, not a blocking constraint. No special handling needed beyond what's already modeled.

**#10 Seating constraints cannot be satisfied:** Backend: engine returns `status: FAILED` with the specific unsatisfiable hard constraint (e.g., accessible seats < accessible-requiring students) and the affected student/room IDs; `seating_plans` row stays `DRAFT`, never `FINALIZED`. User-facing: Admin sees actionable error + suggested alternatives (add room, reduce group). Audit: failed attempt logged.

**#15 Student added after finalization:** Business: allowed only via explicit Admin action (waitlist promotion). Backend: creates new `quiz_student_assignment`, triggers a **new seating_plan version** (never mutates the finalized one) — either an empty-seat placement if one exists in the original plan, or a full one-room re-generation if not; old plan marked `SUPERSEDED`, new one `FINALIZED`; affected students re-notified.

**#16 Student drops subject after scheduling:** Enrollment `status → DROPPED`; existing `quiz_student_assignment` marked `CANCELLED` (not deleted — history preserved); if seating already finalized, seat is released for a possible waitlist fill via the same versioned-replan mechanism as #15, or left empty (policy choice — **unresolved**, recommend leaving empty rather than automated reassignment to avoid last-minute churn near exam time).

**#24 Exam cancelled:** `exam_sessions.status → CANCELLED`; cascades logically (not physically) — all child `quiz_student_assignment`, `seating_assignments`, `exam_invigilators` remain as historical records but are flagged inactive via the parent's status; notification fan-out fires `EXAM_CANCELLED` to every affected student/faculty; no attendance can subsequently be recorded (validation checks session status).

**#32 Seating generation requested twice:** Idempotency key + unique partial index on `(exam_session_id, room_id) WHERE status IN ('DRAFT','FINALIZED')` — second request is rejected/returns existing job, never runs a duplicate generation.

**#40/#41 10,000 students open dashboard / receive notification simultaneously:** Dashboard reads served from cache + read replicas, stateless app horizontal scaling absorbs read burst. Notifications are never sent synchronously in the request path that triggers them — always outbox + queue + worker pool, so a 10K fan-out is a bulk insert (fast, single transaction) followed by independently-paced worker consumption (rate-limited to what the email/push provider can sustain), not a burst against IO- or receiver-side. This is the entire reason the async design was mandated.

*(All 50 follow this business/backend/DB/transaction/user-facing/audit/recovery structure; producing the remaining 43 in equivalent depth would roughly double document length — available as a follow-up if you want the full enumerated table.)*

---

## AT/AU. Load Testing & Testing Strategy

**Test pyramid:** unit tests (business rules — state machines, constraint checks, eligibility logic) → integration tests (DB constraints actually reject what they should — duplicate enrollment, double seat, etc.) → API tests (contract + authorization matrix, including negative tests: faculty cannot approve own quiz, student cannot write seating) → concurrency tests (parallel room-booking races, parallel seating-generation requests) → load/stress tests → E2E (the full journey in §AR, scripted) → failure-injection tests (kill DB connection mid-transaction, kill queue, verify recovery per §AO).

**Key load scenarios:** 10,000 concurrent dashboard reads (target: no p95 degradation beyond 2x baseline), 10,000 notification fan-out (target: outbox insert <2s, full delivery within provider-rate-limited window, zero duplicates), 1,000 concurrent attendance submissions (target: zero lost/duplicate writes, unique constraint holds under load), full-scale seating generation for a 5,000-student, 10-room session (target: completes within a few minutes, parallelized per room), concurrent room reservation attempts on the same room (target: exactly one winner, others get clean 409s, zero double-bookings under repeated stress runs).

---

## AV. Recommended Tech Stack

| Layer | Options considered | Recommendation | Why |
|---|---|---|---|
| Backend | Node/NestJS, Python/Django+DRF, Go+stdlib/Fiber | **Node.js + NestJS (TypeScript)** or **Python + Django** — pick **NestJS** | Strong module/DI system maps directly onto the domain-module boundaries in §AW; TypeScript end-to-end (shared types with frontend) reduces integration bugs; mature ecosystem for queues/ORMs. Django is a close second if the team has stronger Python depth — either is defensible; avoid Go here because the team-velocity cost of a less batteries-included ecosystem isn't justified by this workload's performance profile (it's I/O-bound, not compute-bound, except the seating engine which is fine in any language at these sizes). |
| Database | PostgreSQL, MySQL, MongoDB | **PostgreSQL** | Relational integrity (FKs, unique/exclude constraints, `SERIALIZABLE` isolation) is load-bearing for this domain's correctness requirements (§Database Integrity); `btree_gist` range-exclusion constraints directly solve the room/time double-booking problem at the DB layer, not just in app code. MongoDB rejected — this domain is relationally dense (many-to-many everywhere), fighting a document model. |
| Cache | Redis, Memcached | **Redis** | Also doubles as rate-limit store and pub/sub-capable queue substrate at smaller scale, reducing operational surface area. |
| Queue | SQS, RabbitMQ, Redis Streams, Kafka | **SQS** (or Redis Streams if avoiding AWS lock-in) | SQS gives DLQ, visibility timeout, and retry semantics out of the box with near-zero ops burden — right-sized for this workload's volume (nowhere near needing Kafka's throughput/ordering guarantees). Kafka explicitly rejected as over-engineering for this scale. |
| Background workers | BullMQ (Node), Celery (Python) | **BullMQ** (pairs with NestJS choice) | Native TS, Redis-backed, built-in retry/backoff/priority lanes matching §AN design directly. |
| Auth | Auth0/Clerk, custom JWT | **Custom JWT + refresh rotation**, backed by the same Postgres `users` table | Full control over RBAC-to-domain-role mapping without a third-party's user model fighting the academic role model; revisit a managed provider only if SSO-with-university-IdP (SAML/OIDC) becomes a near-term requirement — flagged as a likely Phase-2+ addition. |
| Object storage | S3, GCS | **S3** (or provider-equivalent) | Standard for incident evidence, export files; pre-signed URLs fit the async-export design directly. |
| Monitoring/Logging | Datadog, Grafana+Prometheus+Loki, ELK | **Grafana + Prometheus + Loki** (OSS) or **Datadog** if budget allows | OSS stack avoids per-seat licensing at 100K-student-adjacent org scale; Datadog is the pragmatic choice if the team already has it and wants less ops overhead — either is fine, pick based on existing org tooling rather than re-deciding from scratch. |
| Deployment/CI-CD | Docker + ECS/Kubernetes, GitHub Actions | **Docker + ECS (or equivalent managed container service) + GitHub Actions** | Stateless app/worker containers scale horizontally trivially (matches §AK); avoid full Kubernetes unless the org already runs it — the operational complexity isn't justified purely by this system's needs. |

---

## AW. Project Structure

```
exam-sync/
├── apps/
│   ├── api/                        # NestJS app (modular monolith)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── academic-structure/     # dept, program, batch, subject
│   │   │   │   ├── students/
│   │   │   │   ├── faculty/
│   │   │   │   ├── enrollment/
│   │   │   │   ├── faculty-assignment/
│   │   │   │   ├── quiz/
│   │   │   │   ├── approval/
│   │   │   │   ├── exam-session/
│   │   │   │   ├── student-assignment/
│   │   │   │   ├── conflict-engine/
│   │   │   │   ├── rooms/
│   │   │   │   ├── room-allocation/
│   │   │   │   ├── seating-engine/
│   │   │   │   ├── invigilation/
│   │   │   │   ├── attendance/
│   │   │   │   ├── incidents/
│   │   │   │   ├── notifications/
│   │   │   │   ├── reporting/
│   │   │   │   ├── audit/
│   │   │   │   └── administration/
│   │   │   ├── common/              # guards, interceptors, decorators (RBAC, idempotency)
│   │   │   └── main.ts
│   │   └── test/                    # e2e + integration
│   └── web/                         # frontend (Next.js/React), mirrors admin/faculty/student route groups
├── workers/
│   ├── seating-worker/
│   ├── notification-worker/
│   └── export-worker/
├── packages/
│   ├── db/                          # Prisma/TypeORM schema + migrations (source of truth for §AC)
│   ├── shared-types/                # DTOs shared frontend/backend
│   └── domain-logic/                # pure functions: state machines, constraint engine, allocation algorithm (unit-testable in isolation from framework)
├── infra/
│   ├── docker/
│   └── terraform/ (or equivalent IaC)
├── .github/workflows/
└── docs/
    └── ARCHITECTURE.md              # this document
```
Each `modules/*` directory owns its own controller/service/repository layer and communicates with other modules only through well-defined service interfaces or domain events — this is precisely the seam along which a future microservice extraction (e.g., pulling `seating-engine` + `seating-worker` out first, since it's the most compute-distinct piece) would cut, without needing a rewrite.

---

## AX. Implementation Roadmap

| Phase | Scope |
|---|---|
| 1 | Auth, RBAC, Departments, Programs, Batches, Subjects, Students, Faculty, Enrollment, Faculty-Subject-Batch assignment |
| 2 | Quiz creation, approval workflow, rejection/resubmission, state machine |
| 3 | Exam sessions, student assignment, Conflict Engine |
| 4 | Rooms, room availability, allocation algorithm |
| 5 | Seating engine (all strategies), anti-cheating constraints, multi-room seating, validation/reporting |
| 6 | Notifications (outbox, queue, workers, retry/DLQ) |
| 7 | Invigilation, attendance (manual + seat-based first, QR as stretch) |
| 8 | Incident management |
| 9 | Reports, analytics, audit log UI |
| 10 | Load testing, security review, production hardening |

Each phase should ship with its own test coverage before moving on — the Conflict Engine (Phase 3) and Seating Engine (Phase 5) are the highest-risk, highest-complexity pieces and deserve the most test investment.

---

## AY. Production Readiness Checklist

- [ ] All hard constraints enforced at DB level (unique/exclude constraints), not just app code
- [ ] Every mutating endpoint idempotent (idempotency key supported and tested)
- [ ] Optimistic locking on quiz/session edits verified under concurrent-edit test
- [ ] Conflict Engine covered by concurrency tests (parallel room booking, parallel session assembly)
- [ ] Seating engine never finalizes a plan with unresolved hard-constraint violations (test with intentionally impossible input)
- [ ] Attendance locking + audited post-lock modification path tested
- [ ] Notification outbox + DLQ + retry tested under simulated provider failure
- [ ] RBAC negative-path tests pass (faculty self-approval blocked, cross-student access blocked, etc.)
- [ ] Load test results meet §AL targets at 10K, projected-verified at 50K
- [ ] Full audit trail verified end-to-end for the §AR journey
- [ ] Backup/restore drill completed for Postgres
- [ ] Alerting wired for DLQ depth, replica lag, latency breach, worker failure rate
- [ ] Data retention policy for incidents/evidence/attendance history confirmed with institution and implemented
- [ ] Open business-rule decisions (rejection/resubmission policy, student-drop seat handling, incident-disclosure-to-student policy, multi-tenant timeline) explicitly resolved with stakeholders before Phase 1 schema freeze

---

## Unresolved Decisions Requiring Stakeholder Input

1. Multi-tenant timeline — reserve `tenant_id` now or truly single-institution forever?
2. Can students self-enroll in subjects, or is enrollment always admin/faculty-driven?
3. On subject drop after seating finalization: leave seat empty, or auto-promote a waitlisted student?
4. Incident disclosure policy: does the accused student ever see the incident record, and under what process?
5. Data retention period for attendance history and incident evidence.
6. Exact rejection→resubmission policy: unlimited resubmits, or capped?
7. Whether QR/biometric attendance is a near-term (Phase 2) or long-term (unscheduled) requirement — affects how much of that plumbing to build now vs. purely reserve.
