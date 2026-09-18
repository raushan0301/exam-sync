# Exam-Sync — Business Rules Catalogue (BUSINESS_RULES.md)

Numbered, testable rules. Each is enforced **server-side**, and at the **database level** wherever the rule maps to a physical constraint (marked 🔒 DB-ENFORCED). Never trust frontend validation for these (see AGENT_DEVELOPMENT_RULES.md, rule 6).

## Academic Structure

- **BR-001**: A department code must be unique. 🔒 `UNIQUE(departments.code)`
- **BR-002**: A program belongs to exactly one department; cannot be reassigned without an explicit admin action that is audited.
- **BR-003**: Deactivating a department/program/subject/batch blocks new assignments/enrollments referencing it but never deletes or hides historical records.

## Enrollment

- **BR-004**: A student can be enrolled in a subject at most once per (subject, academic_year, semester). 🔒 `UNIQUE(student_id, subject_id, academic_year, semester)`
- **BR-005**: Batch membership alone does NOT grant subject eligibility — only an `ENROLLED` enrollment row does.
- **BR-006**: Dropping an enrollment (status → DROPPED) does not retroactively cancel already-finalized seating/attendance for exams already sat; it only blocks future assignment.

## Faculty Assignment

- **BR-007**: Only Admin can create/modify `faculty_subject_batch_assignment` rows.
- **BR-008**: A faculty can hold multiple assignment rows across different subjects and batches, including the same subject to multiple batches.
- **BR-009**: A `faculty_subject_batch_assignment` is unique per (faculty, subject, batch, academic_year, semester). 🔒 DB-ENFORCED

## Quiz

- **BR-010**: Only authorized faculty can create quizzes for subjects/batches they are assigned to (checked against `faculty_subject_batch_assignment`, re-validated at both creation AND submission time, since assignment may change in between).
- **BR-011**: A quiz cannot be scheduled (added to an exam session) until it has been approved (`status = APPROVED`).
- **BR-012**: A rejected quiz must contain a rejection reason. 🔒 CHECK constraint: `action != 'REJECTED' OR reason IS NOT NULL`
- **BR-013**: Every approval/rejection/resubmission decision is appended to `quiz_approval_history`; existing history rows are never updated or deleted.
- **BR-014**: A faculty cannot approve their own quiz — the approve/reject endpoint is Admin-only, with no self-approval code path (not merely UI-hidden).
- **BR-015**: Editing an APPROVED quiz's substantive fields (subject, batch, duration, marks) reverts it to DRAFT and requires re-approval; metadata-only edits (instructions typo fix) may be allowed without re-approval — **flagged as needing product confirmation, see OPEN_DECISIONS.md DEC-010**.

## Exam Session

- **BR-016**: Only Admin can create an exam session or attach/detach quizzes to/from it.
- **BR-017**: Every quiz attached to a session must have `status = APPROVED` at attach time.
- **BR-018**: A room cannot be double-booked — no two `exam_session_rooms` for overlapping time windows on the same room. 🔒 Exclusion constraint (`btree_gist`) on `(room_id, tstzrange(session start, end))`
- **BR-019**: A student cannot have overlapping exam sessions — enforced by the Conflict Engine at session-assembly time inside a `SERIALIZABLE` transaction (not purely a DB constraint, since it requires cross-table evaluation of assignment + session time).
- **BR-020**: A faculty/invigilator cannot be assigned to two rooms with overlapping session time windows. Checked the same way as BR-019.

## Room & Capacity

- **BR-021**: Total students allocated to a room must not exceed the room's active seat count. 🔒 Enforced at allocation time + backstopped by `UNIQUE(seating_plan_id, seat_id)` at seating time.
- **BR-022**: A room under MAINTENANCE status or with an overlapping `room_availability` block cannot be allocated.
- **BR-023**: Multiple subjects may share one room only if the session's configuration explicitly allows it (per-session flag, default true).

## Seating

- **BR-024**: A seat cannot hold two students. 🔒 `UNIQUE(seating_plan_id, seat_id)`
- **BR-025**: A student cannot hold two seats within the same seating plan. 🔒 `UNIQUE(seating_plan_id, student_id)`
- **BR-026**: A seating plan cannot transition to FINALIZED while any HARD constraint (see ARCHITECTURE.md §V) is violated.
- **BR-027**: A finalized seating assignment cannot be modified in place — any post-finalization change creates a new plan version; the old plan is marked SUPERSEDED, never deleted, and the change requires Admin authorization and is audit logged.
- **BR-028**: Accessibility-required students must be placed only in seats flagged `is_accessible = true` — HARD constraint, blocks finalization if unsatisfiable.
- **BR-029**: Students flagged as requiring separation (explicit student-pair rule, e.g. prior incident) must never be placed in adjacent seats — HARD constraint.

## Invigilation

- **BR-030**: A faculty may invigilate any room regardless of what subject they teach.
- **BR-031**: The same faculty cannot be listed as invigilator for two rooms whose sessions overlap in time.

## Attendance

- **BR-032**: Attendance can only be recorded for a student with an active (`ASSIGNED`) `quiz_student_assignment` in a session that is `IN_PROGRESS`.
- **BR-033**: A student cannot have duplicate attendance for the same quiz. 🔒 `UNIQUE(quiz_student_assignment_id)` on `attendance`
- **BR-034**: Attendance automatically locks when the exam session transitions to `COMPLETED`.
- **BR-035**: Modifying locked attendance requires an authorized role, a mandatory reason, and creates an `attendance_history` row recording old value, new value, actor, and timestamp.
- **BR-036**: Attendance cannot be marked for a `CANCELLED` exam session.

## Incidents

- **BR-037**: Any Faculty/Invigilator assigned to the relevant session/room may file an incident.
- **BR-038**: Every incident has a severity (LOW/MEDIUM/HIGH/CRITICAL) at creation; CRITICAL severity triggers an immediate (non-batched) Admin notification.
- **BR-039**: Every incident status transition is appended to `incident_history`; the current `incidents.status` is a cache of the latest state, not the source of truth.
- **BR-040**: An incident does not automatically alter `attendance.status` — any correlated attendance change is a separate, explicit, independently audited action.
- **BR-041**: Incident records are never visible to the referenced student by default; disclosure requires an explicit Admin action (see OPEN_DECISIONS.md DEC-012).

## Notifications

- **BR-042**: Notifications are never sent synchronously within a request that triggers the underlying domain event — always via the outbox+queue pipeline.
- **BR-043**: Each notification has an idempotency key; redelivery of the same event never produces a duplicate user-visible notification. 🔒 `UNIQUE(idempotency_key)`
- **BR-044**: A notification exhausting its retry budget moves to a dead-letter state and raises an operational alert; it is never silently dropped without a record.

## Authorization

- **BR-045**: A student can only access their own records (schedule, attendance, seat, notifications) — never another student's, regardless of client-supplied IDs.
- **BR-046**: A faculty can only access/edit a quiz they created or co-instruct; cannot view another faculty's DRAFT quiz.
- **BR-047**: Only Admin roles can access audit logs, room management, department/program/batch management, and the approval queue.

## Audit

- **BR-048**: Every state-changing action across quiz, session, assignment, allocation, seating, attendance, incident, room, and notification domains produces an `audit_logs` row in the same transaction as the change — never as an eventual/best-effort side effect.
- **BR-049**: Audit log rows are append-only; no update or delete operation exists against `audit_logs` in the application layer.

## Idempotency & Concurrency

- **BR-050**: Every side-effecting POST/PATCH that could plausibly be retried by a client (quiz submission, seating generation, bulk import, notification-triggering actions) must accept and honor an `Idempotency-Key` header.
- **BR-051**: Any endpoint performing an optimistic-lock-sensitive update (quiz edit, session edit) must require the client to supply the last-known `version`; a mismatch returns 409, never a silent overwrite.

## Bulk Operations

- **BR-052**: A bulk operation's partial failure never rolls back successfully processed items silently; the result must report per-item success/failure so the caller can retry only the failed subset.
