# Exam-Sync — Product Requirements Document (PRD.md)

Describes **what** the product does. See [ARCHITECTURE.md](ARCHITECTURE.md) for **how**.

---

## 1. Product Overview

Exam-Sync is a University/College Examination & Quiz Management Platform covering the full lifecycle: academic structure setup → enrollment → faculty assignment → quiz authoring → admin approval → multi-subject exam session scheduling → room/seat allocation with cheating-risk reduction → attendance → incident handling → notifications → reporting/audit. Initial scale: 10,000+ students; must scale to 50,000–100,000+ without architectural rework.

## 2. Product Goals

- Replace ad hoc spreadsheet/manual exam scheduling with a system that guarantees no double-bookings, no seat conflicts, no unauthorized quiz creation.
- Give admins a single approval gate and full audit visibility over every quiz and exam session.
- Reduce opportunistic cheating via configurable seating strategies (explicitly a risk-reduction tool, not a guarantee).
- Give students and faculty accurate, timely, self-service visibility into schedules, rooms, seats, and attendance.
- Support institutional growth (more departments, more students) without a re-architecture.

## 3. Non-Goals

- Not a learning management system (no course content delivery, grading of quiz answers, or question banks with auto-grading — out of scope unless explicitly requested later).
- Not a general-purpose calendar/timetabling system for regular classes (only exams/quizzes).
- Not a payment/fee management system.
- Not a biometric identity system (architecture reserves the extension point only; not implemented — see [OPEN_DECISIONS.md](OPEN_DECISIONS.md) DEC-013).
- Not a public/multi-institution SaaS in v1 (single institution — see DEC-001).

## 4. Target Users

- University/college administration (exam cell, registrar-adjacent staff).
- Teaching faculty across departments.
- Enrolled students.
- Faculty acting as invigilators (not a distinct person type — a role faculty play per session).

## 5. User Roles

| Role | Summary |
|---|---|
| **ADMIN** | Full visibility; approves/rejects quizzes; creates exam sessions; allocates rooms; manages academic structure, rooms, incidents; views audit logs. Multiple admins supported from day one. |
| **FACULTY** | Creates quizzes for subjects/batches they're assigned to; views their students/rosters; may be assigned as invigilator for any room; marks attendance where authorized; reports incidents. |
| **STUDENT** | Views own upcoming exams, room/seat, notifications, attendance history. No write access to scheduling, seating, attendance, or incidents. |
| **INVIGILATOR** (logical role) | A FACULTY user assigned to a room for a session; gains attendance-marking and incident-reporting authority scoped to that room/session. |

Future roles (not built now, flagged as extension points): DEPARTMENT_ADMIN, EXAM_COORDINATOR, SUPER_ADMIN.

## 6. Core Use Cases

1. Admin sets up departments, programs, batches, subjects.
2. Admin enrolls/maps students to subjects and faculty to subject+batch pairs.
3. Faculty creates a quiz for an authorized subject+batch; submits for approval.
4. Admin approves or rejects (with reason) the quiz.
5. Admin combines multiple approved quizzes into one exam session.
6. System computes eligible students, admin allocates rooms, generates seating.
7. Faculty/invigilator marks attendance and reports incidents during the exam.
8. Admin reviews and resolves incidents.
9. Students and faculty receive notifications at each milestone.
10. Admin runs reports and reviews audit logs after the exam.

## 7. Functional Requirements

Numbered `FR-xxx`; each maps to a Business Rule (`BR-xxx`, see [BUSINESS_RULES.md](BUSINESS_RULES.md)) and an API (see [API_CONTRACT.md](API_CONTRACT.md)).

### 8. Academic Structure — MUST HAVE
**FR-001**: Admin can create/edit/deactivate Departments (name, code, status).
**FR-002**: Admin can create/edit/deactivate Programs under a Department.
**FR-003**: Admin can create/edit/deactivate Batches under a Program (year, section).
Business rules: department/program codes unique; deactivation blocks new downstream assignments but never deletes history.

### 9. Student Management — MUST HAVE
**FR-004**: Admin can create/import students with program+batch, roll number, contact/email.
**FR-005**: Admin can deactivate a student (status change, not delete).
Acceptance: duplicate roll number rejected with 409.

### 10. Faculty Management — MUST HAVE
**FR-006**: Admin can create/import faculty with home department, employee code.
**FR-007**: Admin can deactivate faculty; existing quizzes/history are preserved (see EDGE_CASES.md EC-049).

### 11. Subject Management — MUST HAVE
**FR-008**: Admin can create/edit/deactivate Subjects (code, name, department, optional program linkage, credits).

### 12. Batch Management — MUST HAVE
**FR-009**: Admin manages batch rosters; a student's batch can change (see EC-017), and history reflects the batch at the time of each historical action, not retroactively.

### 13. Enrollment — MUST HAVE
**FR-010**: Admin/Faculty enrolls a student in a subject for a given academic year/semester. Batch membership alone does NOT grant eligibility.
**FR-011**: Enrollment has status ENROLLED/DROPPED/COMPLETED/INACTIVE/WITHDRAWN.
**FR-012**: Quiz eligibility is derived from `ENROLLED` enrollment matching the quiz's subject/year/semester — never inferred from batch alone.
Acceptance: duplicate enrollment (same student+subject+year+semester) rejected with 409.

### 14. Faculty-Subject-Batch Mapping — MUST HAVE
**FR-013**: Admin maps Faculty ↔ Subject ↔ Batch (with role PRIMARY_INSTRUCTOR/CO_INSTRUCTOR).
**FR-014**: A subject taught to different batches by different faculty is fully supported; the same faculty may teach the same subject to multiple batches.
**FR-015**: Faculty can create a quiz ONLY for subject+batch pairs present in their own assignment rows.

### 15. Quiz Creation — MUST HAVE
**FR-016**: Faculty creates a quiz (title, subject, batch(es), duration, marks, question count, instructions, type, preferred date/time, academic year/semester). Starts as DRAFT.
**FR-017**: Faculty submits DRAFT → SUBMITTED (locks most fields; see state machine).
Business rule: server re-validates faculty's authorization for subject+batch at submission time, not just creation time (assignment may have changed).

### 16. Admin Approval — MUST HAVE
**FR-018**: Admin reviews SUBMITTED quizzes; approves → APPROVED.
**FR-019**: Every approval/rejection decision is appended to an immutable history log; never overwritten.

### 17. Quiz Rejection — MUST HAVE
**FR-020**: Admin rejects with a mandatory reason. Quiz → REJECTED; faculty sees the reason.

### 18. Quiz Resubmission — SHOULD HAVE
**FR-021**: Faculty may edit a REJECTED quiz and resubmit → back to SUBMITTED, with a new history entry. Resubmission cap: none by default (see DEC-011, unresolved — confirm policy).

### 19. Exam Session Creation — MUST HAVE
**FR-022**: Admin creates an Exam Session (date, time window) and attaches one or more APPROVED quizzes.
**FR-023**: All quizzes in a session must be APPROVED; adding a non-approved quiz is rejected.

### 20. Multi-Faculty Collaboration — MUST HAVE
**FR-024**: A session can contain quizzes authored by different faculty; each retains ownership/visibility of their own quiz within the shared session.

### 21. Multi-Subject Exam Sessions — MUST HAVE
**FR-025**: A session supports multiple subjects, multiple batches, run concurrently in shared or separate rooms.

### 22. Student Assignment — MUST HAVE
**FR-026**: System computes eligible students per quiz from enrollment; creates assignment records when the session enters student-assignment stage.
**FR-027**: Admin can view/adjust the roster (add a waitlisted/late student, cancel a student's assignment) before finalization, each change audited.

### 23. Room Selection — MUST HAVE
**FR-028**: Admin selects from available rooms (filtered by capacity, building, availability calendar) for a session.

### 24. Room Allocation — MUST HAVE
**FR-029**: System (or admin-triggered algorithm) allocates students across selected rooms respecting capacity; prevents double-booking and over-capacity.
**FR-030**: Multiple subjects may share one room (configurable per session).

### 25. Seating Arrangement — MUST HAVE
**FR-031**: Admin triggers seating generation with a chosen strategy (Sequential, Random, Alternate-Subject, Batch Alternation, Subject+Batch Mix, Anti-Cheating).
**FR-032**: Seating plan must pass hard-constraint validation before it can be finalized; soft-constraint violations are reported, not hidden.

### 26. Anti-Cheating Constraints — MUST HAVE
**FR-033**: Engine attempts to avoid seating same-subject/same-quiz students adjacently; falls back to batch/randomization/spacing when only one subject/quiz is present.
**FR-034**: UI and API responses explicitly state seating reduces, not eliminates, cheating opportunity.

### 27. Invigilation — MUST HAVE
**FR-035**: Admin assigns faculty as invigilator(s) to a room within a session, regardless of what subject that faculty teaches.
**FR-036**: A faculty member cannot be double-booked as invigilator across overlapping sessions.

### 28. Attendance — MUST HAVE
**FR-037**: Invigilator/faculty marks Present/Absent/Late/Excused/Medical/Other per student, tied to student+session+quiz+room+seat+timestamp.
**FR-038**: Attendance locks automatically when the session completes; post-lock changes require reason + audit entry.

### 29. Incident Reporting — MUST HAVE
**FR-039**: Faculty/invigilator files incidents with type, severity, description, optional evidence metadata, linked to session/quiz/student/room/seat.
**FR-040**: Admin triages incidents through OPEN → UNDER_REVIEW → RESOLVED/DISMISSED/ESCALATED.

### 30. Notifications — MUST HAVE
**FR-041**: Students/faculty are notified (in-app + email) on: quiz approved/rejected, seat/room assigned, exam rescheduled/cancelled, incident status updates concerning them (per disclosure policy — DEC-012).
**FR-042**: Notifications are delivered asynchronously and reliably (no user-visible drop on transient failure).

### 31. Student Dashboard — MUST HAVE
**FR-043**: Upcoming exams (subject, date, time, room, seat, instructions), notifications, attendance history, past quizzes, schedule changes. No incident visibility by default.

### 32. Faculty Dashboard — MUST HAVE
**FR-044**: My quizzes by status, my students/subjects/batches, exam sessions, assigned rooms, invigilation duties, attendance, incidents, seating plans.

### 33. Admin Dashboard — MUST HAVE
**FR-045**: Approval queue, exam sessions, room utilization, seating plans, attendance, incidents, faculty/student/subject/department/batch management, notifications, audit logs, conflicts, system health.

### 34. Reports — SHOULD HAVE
**FR-046**: Exportable (async, CSV/Excel) reports: attendance, seating plan, exam roster, incident report, student schedule, room utilization.

### 35. Audit Requirements — MUST HAVE
**FR-047**: Every state-changing action (quiz lifecycle, approvals, assignment, allocation, seating, attendance changes, incident actions, schedule/room/seat changes, notifications) is recorded with actor, action, entity, before/after values, timestamp, reason where applicable.

### 36. Search/Filter/Pagination — MUST HAVE
**FR-048**: All list views (students, faculty, quizzes, sessions, incidents, audit logs) support server-side search, filter, and cursor-based pagination — never full unpaginated loads at scale.

### 37. Bulk Operations — MUST HAVE
**FR-049**: Bulk student assignment, bulk attendance entry, bulk notification, bulk import/export — all processed asynchronously for large batches, with partial-failure reporting (not all-or-nothing silent failure — see EC-044).

### 38. Import/Export — SHOULD HAVE
**FR-050**: CSV/Excel import for students, faculty, subjects, batches, enrollments, rooms. Exports as above (FR-046). Large imports/exports run as background jobs with progress/result reporting.

### 39. Security Requirements — MUST HAVE
**FR-051**: RBAC + resource-level authorization on every endpoint; no critical rule enforced only client-side; passwords hashed (never reversible); audit trail tamper-evident (append-only).

### 40. Accessibility Requirements — SHOULD HAVE
**FR-052**: Seating engine supports accessibility-required seat assignment (hard constraint). Dashboards should meet WCAG 2.1 AA for core flows (schedule viewing, attendance marking) — flagged SHOULD HAVE for v1, not blocking launch.

### 41–44. Non-Functional / Scalability / Reliability / Performance
See [ARCHITECTURE.md](ARCHITECTURE.md) §AK/AL for full targets. Summary: p95 API latency <500ms for synchronous ops; seating/notifications/exports async; 99.9% availability during exam windows; scale to 100K+ students via stateless horizontal scaling + read replicas + partitioning, no sharding required.

### 45. Edge Cases
See [EDGE_CASES.md](EDGE_CASES.md) for the full catalogue (50+ cases).

## 46. Representative User Stories & Acceptance Criteria

### Story: Faculty creates and submits a quiz
- **User**: Faculty
- **Goal**: Get a quiz approved so it can be scheduled.
- **Preconditions**: Faculty has an active `faculty_subject_batch_assignment` for the target subject+batch.
- **Main flow**: Faculty fills quiz form → saves as DRAFT → edits → submits.
- **Alternative flows**: Save as draft and return later; submit directly from creation.
- **Error cases**: Faculty attempts to create a quiz for a subject/batch they're not assigned to → 403. Missing required field → 422.
- **Business rules**: BR-001, BR-002.
- **Acceptance criteria**: Given an assigned faculty, when they submit a complete quiz, then status becomes SUBMITTED and it appears in the admin approval queue within the same transaction (no polling delay).

### Story: Admin rejects a quiz
- **User**: Admin
- **Goal**: Prevent an unsuitable quiz from proceeding, with traceable reasoning.
- **Preconditions**: Quiz is in SUBMITTED status.
- **Main flow**: Admin opens quiz, selects Reject, enters reason, confirms.
- **Error cases**: Reject without reason → 422 (reason mandatory).
- **Business rules**: BR-003.
- **Acceptance criteria**: Given a SUBMITTED quiz, when admin rejects with reason "insufficient questions," then quiz.status = REJECTED, a `quiz_approval_history` row is created with that reason, and faculty receives a notification containing the reason.

### Story: Admin combines quizzes into an exam session
- **User**: Admin
- **Goal**: Run DBMS/OS/CN exams concurrently in shared rooms.
- **Preconditions**: All three quizzes are APPROVED; no known student/faculty/room conflicts.
- **Main flow**: Admin creates session, selects date/time, attaches the three quizzes, system runs Conflict Engine, admin allocates rooms, admin generates seating, admin finalizes.
- **Error cases**: A HARD conflict (e.g., a student appears in two of the three quizzes) blocks session creation with a structured error naming the student.
- **Business rules**: BR-004, BR-005, BR-013 (see BUSINESS_RULES.md).
- **Acceptance criteria**: Given three approved quizzes with no student overlap, when admin combines them into a session and finalizes seating, then every eligible student has exactly one seat assignment, and the seating plan passes hard-constraint validation.

### Story: Student views their exam schedule
- **User**: Student
- **Goal**: Know where/when to show up.
- **Preconditions**: Session finalized and notified.
- **Acceptance criteria**: Given a finalized session with the student assigned, when the student opens their dashboard, then they see subject, date, time, building, room, seat, and instructions, and this data matches the `seating_assignments` record exactly.

*(Additional user stories for attendance-marking, incident-reporting, and bulk import follow the same template and are implied by FR-037 through FR-050; not all are expanded here to avoid redundancy with EDGE_CASES.md and API_CONTRACT.md, which cover the same flows at implementation-relevant detail.)*

## 47. Prioritization Summary

| Priority | Features |
|---|---|
| **MUST HAVE** | Academic structure, student/faculty mgmt, enrollment, faculty-subject-batch mapping, quiz lifecycle + approval, exam sessions, conflict engine, room allocation, seating (core strategies + anti-cheating), invigilation, attendance, incident reporting, notifications (async), dashboards, audit log, RBAC, pagination/search, bulk ops |
| **SHOULD HAVE** | Resubmission workflow, CSV/Excel import/export, reports, QR attendance, WCAG AA |
| **COULD HAVE** | Department-level admin role, exam coordinator role, richer analytics/BI dashboards |
| **FUTURE** | Multi-tenant/multi-institution, biometric attendance, mobile native app, public API for third-party LMS integration |
