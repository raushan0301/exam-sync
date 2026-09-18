# Exam-Sync — Edge Case Catalogue (EDGE_CASES.md)

50 edge cases. Format: Scenario → Expected behavior → Backend → Database → Transaction → User-facing message → Audit → Recovery.

---

**EC-001 — Student registered for multiple subjects, all in one session.**
Expected: allowed; student gets one `quiz_student_assignment` per subject/quiz within the session, one seat per quiz. Backend: no special handling — each quiz assignment is independent. DB: `UNIQUE(quiz_id, student_id)` allows multiple quiz_ids for one student. Transaction: none needed beyond normal assignment insert. User-facing: student dashboard lists multiple exam cards for the same time slot with different rooms/seats — flagged with a "back-to-back" indicator. Audit: standard assignment audit entries. Recovery: n/a.

**EC-002 — Two subjects share the same student, but scheduled at overlapping (not identical) session times.**
Expected: BLOCKED at session-assembly time. Backend: Conflict Engine detects overlap via session time-range comparison, not just same-session membership. DB: checked query, not a constraint (cross-entity). Transaction: `SERIALIZABLE` check-then-insert. User-facing: 409 naming the student and both conflicting sessions. Audit: rejected attempt is NOT logged as a state change (no state changed) but may be logged as a conflict-check event for observability. Recovery: admin adjusts one session's time or removes the student from one quiz.

**EC-003 — Two quizzes scheduled at overlapping times but never combined into one session.**
Expected: allowed at the quiz level (quizzes don't inherently conflict); conflict only materializes when students overlap AND both are attached to sessions. Backend: conflict check happens at session-assembly, not quiz-creation. DB: n/a. Recovery: n/a — this is expected, not an error, until session assembly is attempted.

**EC-004 — Multiple subjects share one room.**
Expected: allowed, explicit feature (BR-023). Backend: seating engine treats subject as a seating dimension, not a room-exclusivity rule. DB: `seating_assignments` seat_id unique per plan is the only hard constraint; subject diversity is a soft constraint. Recovery: n/a.

**EC-005 — One subject requires multiple rooms (class larger than any single room).**
Expected: allowed; room allocation algorithm splits the cohort across rooms (Best-Fit Decreasing, ARCHITECTURE.md §S). Backend: each room gets its own `seating_plan`. DB: multiple `exam_session_rooms` rows for one session. User-facing: admin sees "Room 101: 60 DBMS students, Room 102: 40 DBMS students." Recovery: n/a.

**EC-006 — Same subject requires multiple rooms, and rooms are in different buildings.**
Expected: allowed but flagged as a WARNING soft-conflict ("building changes increase invigilator complexity" per ARCHITECTURE.md §S optimization goals) — not blocked. Backend: allocation algorithm prefers same-building tie-break but doesn't hard-require it. Recovery: admin can override room selection manually.

**EC-007 — Different batches of same subject combined into one session.**
Expected: allowed, common case. Backend/DB: `quiz_batches` already M:N; no special handling. Recovery: n/a.

**EC-008 — Students from different subjects sit alternately (intended behavior).**
Expected: this is the ANTI_CHEATING/ALTERNATE_SUBJECT strategy working correctly, not an error.

**EC-009 — Same-subject students accidentally become adjacent (algorithm limitation).**
Expected: recorded as a soft-constraint violation in the seating validation report (ARCHITECTURE.md §V), never silently hidden. Backend: `soft_constraint_score` reflects it; violation list names the specific seats. User-facing: admin sees violation count/detail before finalizing, can regenerate with different strategy or accept. Recovery: admin re-runs generation or manually swaps two students (a manual override action, itself audited).

**EC-010 — Seating constraints cannot be satisfied at all (e.g., more accessibility-required students than accessible seats).**
Expected: HARD failure. Backend: engine returns `status: FAILED`, never finalizes. DB: `seating_plans.status` stays DRAFT/FAILED, never FINALIZED. User-facing: structured error naming the unsatisfiable constraint, affected students, and suggested alternatives (add room, reduce accessible-seat requirement mismatch). Audit: failed attempt logged. Recovery: admin adds capacity/rooms and retries.

**EC-011 — Room capacity insufficient for the session's total assigned students.**
Expected: allocation algorithm aborts before assigning any room, returns shortfall count. Backend: pre-check total capacity vs. total students before committing any `exam_session_rooms` rows (all-or-nothing for the allocation step). Transaction: single transaction, rolled back on shortfall. User-facing: "Shortfall: 40 students, no additional capacity in selected rooms." Recovery: admin selects additional rooms.

**EC-012 — Room becomes unavailable (maintenance) after being allocated to a session but before the exam.**
Expected: system flags the conflict proactively (a background check or admin-triggered "revalidate" action) — not silently ignored. Backend: when `room_availability` or `rooms.status` changes, a check runs against existing `exam_session_rooms` for future sessions; conflicts surfaced to Admin dashboard. DB: no automatic cascade — human decision required. User-facing: Admin sees an alert "Room 204 now unavailable for Session #1001 (in 3 days)." Recovery: admin reallocates; triggers a new seating plan version if seating was already finalized (same mechanism as EC-015 below).

**EC-013 — Faculty becomes unavailable (e.g., marked inactive) after being assigned as invigilator.**
Expected: similar to EC-012 — surfaced as an alert, not auto-resolved. Recovery: admin reassigns invigilator.

**EC-014 — Invigilator conflict introduced after initial assignment (e.g., faculty added to another overlapping session later).**
Expected: BLOCKED at the second assignment attempt (BR-031 checked at insert time, not just initially) — the conflict can never be created in the first place if checks are always run at write time. Recovery: n/a, prevented by design.

**EC-015 — Student added after seating finalization (e.g., waitlist promotion).**
Expected: allowed via explicit Admin action only. Backend: creates new `quiz_student_assignment`; either places into an existing empty seat in a new plan version, or triggers a bounded re-generation for the affected room. DB: old `seating_plans` row marked SUPERSEDED (never deleted), new row FINALIZED. Transaction: whole re-plan committed atomically. User-facing: affected students (the added one, and any whose seat changed) are re-notified. Audit: full diff logged. Recovery: n/a — this IS the recovery path for late additions.

**EC-016 — Student drops the subject after scheduling but before the exam.**
Expected: enrollment → DROPPED; `quiz_student_assignment` → CANCELLED (not deleted). Backend: if seating already finalized, seat is released — left empty by default (see OPEN_DECISIONS.md DEC-014 for auto-reassignment policy). DB: historical rows preserved. Recovery: n/a.

**EC-017 — Student changes batch after enrollment/assignment.**
Expected: existing enrollment/assignment rows retain the batch value AS OF THAT TIME (not retroactively updated) — `student_subject_enrollment.batch_id` is a point-in-time snapshot, not a live FK-follow. Backend: student's `students.batch_id` (current) can differ from historical enrollment rows' `batch_id` — this is intentional. Recovery: n/a, this is correct historical behavior by design.

**EC-018 — Quiz rejected.**
See BR-012, BR-013. User-facing: faculty sees status + reason. Recovery: faculty edits and resubmits (EC-019) if resubmission policy allows.

**EC-019 — Quiz resubmitted.**
Expected: REJECTED → (edit) → SUBMITTED again; new `quiz_approval_history` row; previous rejection entry untouched. Recovery: n/a — normal flow.

**EC-020 — Approved quiz modified.**
Expected: substantive field changes (subject/batch/duration/marks) revert status to DRAFT, forcing re-approval (BR-015). Metadata-only edits are a product decision — see DEC-010. Backend: field-level diff determines whether a status reset is triggered. Recovery: n/a.

**EC-021 — Exam rescheduled (date/time changed) after quizzes attached.**
Expected: Conflict Engine re-runs against the new time window before the reschedule commits; if new conflicts arise, reschedule is BLOCKED with the same structured error as initial assembly. Backend: reschedule is itself a state-changing action requiring re-validation, not a bare field update. Recovery: admin picks a conflict-free time or resolves the conflict first.

**EC-022 — Room changed after students already notified.**
Expected: allowed via explicit Admin action; triggers re-notification (`ROOM_CHANGED` event) and, if seating was already generated for the old room, a new seating_plan version for the new room. Recovery: n/a — this is the recovery path.

**EC-023 — Seat changed after notification (e.g., manual admin swap).**
Expected: allowed, audited, triggers a targeted `SEAT_CHANGED` notification to only the affected student(s), not a full re-broadcast. Recovery: n/a.

**EC-024 — Exam cancelled.**
Expected: `exam_sessions.status → CANCELLED`; child records (assignments, seating, invigilators) remain as historical data but are logically inactive via parent status; attendance blocked (BR-036); full cancellation notification fan-out. Recovery: n/a — cancellation is terminal; a new session must be created if rescheduling is intended.

**EC-025 — Notification failure (provider outage).**
Expected: retried with exponential backoff (ARCHITECTURE.md §AB); exhausted retries → dead-letter + alert, never silently dropped. In-app notification (DB-backed) still shows regardless of email/push provider status. Recovery: ops resolves provider issue, DLQ items can be manually replayed.

**EC-026 — Duplicate notification (e.g., event fired twice due to retry).**
Expected: prevented by `idempotency_key` uniqueness (BR-043) — the outbox insert itself is idempotent per (event_type, recipient, entity, entity_version), so redelivery of the underlying domain event does not produce a second row. Recovery: n/a, prevented by design.

**EC-027 — Duplicate attendance submission (e.g., double-tap on UI).**
Expected: `UNIQUE(quiz_student_assignment_id)` on `attendance` rejects the second insert with 409; client should treat 409-on-create as "already marked" and fetch current state rather than erroring loudly. Recovery: n/a.

**EC-028 — Attendance changed after the exam (post-lock).**
Expected: requires authorized role + mandatory reason (BR-035); creates `attendance_history` row. Blocked entirely without a reason (422). Recovery: n/a — this IS the controlled recovery path.

**EC-029 — Incident created after the exam has ended.**
Expected: allowed — incidents can be filed retroactively (e.g., discovered evidence after the fact) as long as they reference a valid completed session; incident creation is NOT gated by session status the way attendance is. Recovery: n/a.

**EC-030 — Incident escalated.**
Expected: status → ESCALATED, `incident_history` row created, Admin notified immediately regardless of standard notification batching (severity=CRITICAL or explicit escalation both trigger immediate-lane delivery). Recovery: n/a — normal workflow.

**EC-031 — Faculty accidentally reports the wrong student in an incident.**
Expected: no "delete" — Admin can transition the incident to DISMISSED with a resolution note explaining the error; a corrected incident is filed fresh. History preserves the original (mistaken) report for accountability. Recovery: file a new, correct incident; dismiss the erroneous one.

**EC-032 — Seating generation requested twice (double-click, or retried request).**
Expected: prevented via idempotency key + unique partial index on `(exam_session_id, room_id) WHERE status IN ('DRAFT','FINALIZED')` (ARCHITECTURE.md §AH) — second request returns the existing job/plan rather than generating a duplicate. Recovery: n/a, prevented by design.

**EC-033 — Two admins attempt the same operation concurrently (future multi-admin scenario).**
Expected: whichever transaction commits first wins; the second hits either a unique constraint violation, an optimistic-lock version mismatch, or a `SELECT ... FOR UPDATE` wait-then-conflict, depending on the operation (see ARCHITECTURE.md §AH table). User-facing: second admin gets a clear "this was just modified by another admin, please refresh" message (409), not a silent overwrite or a crash. Recovery: refresh and retry.

**EC-034 — Database failure during a bulk assignment operation.**
Expected: the bulk operation is chunked into sub-transactions (e.g., batches of 500) rather than one giant transaction; a mid-run DB failure leaves completed chunks committed and the job resumable from the last successful chunk (tracked via a job-progress record), not a full rollback of already-succeeded work. User-facing: job status shows "partial — resume available." Recovery: retry resumes from checkpoint; each chunk's insert is itself idempotent (upsert or idempotency-key-guarded) so a resumed chunk boundary re-run is safe.

**EC-035 — Queue failure during notification dispatch.**
Expected: outbox rows remain `PENDING` in Postgres (source of truth unaffected); relay resumes once queue recovers — no data loss, only delay. Recovery: automatic on queue recovery; no manual intervention needed unless the outage is prolonged enough to trigger the DLQ alert threshold.

**EC-036 — Student opens dashboard while their schedule is mid-finalization (seating job still running).**
Expected: dashboard shows "Schedule being finalized" state for that session rather than a stale or partial seat, until `seating_plans.status = FINALIZED`. Backend: dashboard query only surfaces FINALIZED plans; DRAFT/generating plans are invisible to students. Recovery: n/a — this is a read-consistency design choice, not a failure.

**EC-037 — Faculty loses connection while mid-way through marking attendance for a room.**
Expected: attendance marks already submitted are already persisted (each mark is its own request/transaction, not one giant batch submit) — no loss of already-marked students. Backend: client should support offline queuing/retry of unsent marks with idempotency keys per student-mark. Recovery: faculty reconnects, resumes marking remaining students; already-marked ones show correctly, no duplicates due to BR-033.

**EC-038 — Student tries to access another student's seat/schedule info via a manipulated request.**
Expected: BLOCKED — 403, resource-level authorization checks `student_id` against the authenticated identity server-side on every request, never trusting a client-supplied ID (BR-045). Audit: unauthorized-access attempts should be logged for security monitoring (rate-limited alerting if repeated). Recovery: n/a — this is a security control, not an error state.

**EC-039 — Faculty tries to access a batch/subject they are not assigned to.**
Expected: BLOCKED — 403, same pattern as EC-038, enforced against `faculty_subject_batch_assignment` (BR-046). Recovery: n/a.

**EC-040 — 10,000 students open the dashboard simultaneously (e.g., results/schedule just published).**
Expected: no degraded correctness; latency may rise but is absorbed by horizontal app scaling + read replicas + cache (ARCHITECTURE.md §AK/AL). Recovery: auto-scaling handles it; if capacity is exceeded, requests queue/rate-limit gracefully rather than the DB falling over.

**EC-041 — 10,000 students receive a notification simultaneously (e.g., mass exam-cancellation).**
Expected: bulk outbox insert (single fast transaction) + independently-paced worker consumption — never a synchronous fan-out in the triggering request. Recovery: n/a, this is exactly what the async design (BR-042) exists to handle.

**EC-042 — 1,000 attendance records submitted concurrently (all invigilators in a large session marking at once).**
Expected: each is an independent transaction on a distinct row (different `quiz_student_assignment_id`) — no lock contention between different students' rows; DB handles this trivially at Postgres row-lock granularity. Recovery: n/a.

**EC-043 — Large seating plan generation (thousands of students, dozens of rooms).**
Expected: parallelized per-room (each room's seating is an independent sub-problem — ARCHITECTURE.md §T/§U), run as background jobs, not one synchronous blocking call. User-facing: progress-trackable job status. Recovery: if one room's sub-job fails, others are unaffected; failed room can be retried independently.

**EC-044 — Partial failure during a bulk operation (e.g., CSV import — 950 of 1000 rows valid).**
Expected: NOT all-or-nothing by default for import; valid rows are committed, invalid rows are reported individually with reason (row number, field, error) so the caller can fix and re-submit only the failed subset (BR-052). Recovery: re-upload a corrected file containing only the failed rows.

**EC-045 — Duplicate API request (network retry, double-submit).**
Expected: `Idempotency-Key` header ensures the second request returns the original response rather than re-executing the side effect (BR-050). Recovery: n/a, prevented by design.

**EC-046 — Stale browser/client data (client acts on data that's since changed server-side).**
Expected: optimistic-lock `version` mismatch → 409 with current server state included in the error body so the client can reconcile/refresh rather than blindly retrying with stale data. Recovery: client refetches and retries.

**EC-047 — Old quiz version approved accidentally (e.g., admin approves based on stale cached view).**
Expected: version-checked — the approve action must include the `version` the admin was viewing; if the quiz changed since (e.g., faculty edited it after admin opened the approval screen but before clicking approve), the approve request 409s rather than approving unseen content. Recovery: admin refreshes and reviews the current version before approving.

**EC-048 — Room seat configuration changed (e.g., seats added/removed) after a seating plan was already finalized against the old layout.**
Expected: changing `room_seats` for a room with any FINALIZED (non-SUPERSEDED) future-dated seating plan is BLOCKED or requires explicit acknowledgment + forced re-plan — never silently allowed to desync seat references. Recovery: admin either waits until no future finalized plans reference the room, or explicitly triggers a re-generation for affected sessions as part of the seat-config change.

**EC-049 — Faculty deleted/inactivated after quiz creation.**
Expected: faculty is never hard-deleted (soft `status=INACTIVE` only); existing quizzes, approval history, and assignment rows retain the FK reference and display correctly with an "inactive faculty" indicator. Recovery: n/a — this is why hard delete is disallowed for any entity with historical significance (AGENT_DEVELOPMENT_RULES.md rule 15).

**EC-050 — Subject becomes inactive while a quiz referencing it still exists (e.g., still scheduled, not yet run).**
Expected: `subjects.is_active = false` blocks NEW quiz creation/enrollment against that subject but does not retroactively invalidate already-approved/scheduled quizzes — those proceed to completion normally. Admin sees a warning banner on the affected quiz/session, not a hard block, since cancelling an already-scheduled exam has its own explicit workflow (EC-024). Recovery: n/a, or admin explicitly cancels the session if the deactivation genuinely invalidates the exam.
