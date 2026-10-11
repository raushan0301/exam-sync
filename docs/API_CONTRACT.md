# Exam-Sync — API Contract (API_CONTRACT.md)

REST, JSON, `/api/v1` prefix, bearer JWT auth. This is a **contract**, not an implementation — no handlers exist yet. All list endpoints use cursor pagination (`?cursor=&limit=`, default limit 25, max 200) and support `?search=` and relevant `?filter[...]=` params unless noted. Every mutating endpoint honors `Idempotency-Key` (BR-050) where side effects could plausibly be retried.

**Standard error envelope:**
```json
{ "error": { "code": "CONFLICT", "message": "...", "details": [ { "field": "...", "reason": "..." } ] } }
```

---

## Authentication

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | none | body `{email, password}`; rate-limited per IP+email; returns `{access_token, refresh_token, expires_in}` |
| POST | `/auth/refresh` | refresh token | rotates refresh token; old one invalidated |
| POST | `/auth/logout` | access token | revokes refresh token |

## Users / RBAC

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | any | returns identity + roles |
| GET | `/users` | ADMIN | paginated, filterable by role/status |
| POST | `/users/{id}/roles` | ADMIN | assign role; validation: role must exist |

## Departments / Programs / Batches

| Method | Endpoint | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/departments` | ADMIN | `{name, code}` | `201 {id,...}` | `409` duplicate code |
| GET | `/departments` | any authenticated | query `status` | paginated list | — |
| PATCH | `/departments/{id}` | ADMIN | partial fields incl. `status` | `200` | `404` |
| POST | `/programs` | ADMIN | `{department_id, name, code}` | `201` | `404` bad dept, `409` dup code |
| POST | `/batches` | ADMIN | `{program_id, year, section}` | `201` | `409` dup (program,year,section) |

## Students

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/students` | ADMIN | body incl. `program_id, batch_id, roll_number`; `409` on dup roll_number |
| POST | `/students/bulk-import` | ADMIN | multipart CSV; **async**, returns `202 {job_id}`; poll `/import-jobs/{job_id}` for per-row results (EC-044) |
| GET | `/students/{id}` | ADMIN, FACULTY (if teaches them), or the student themself | resource-level check |
| GET | `/students/{id}/schedule` | self or ADMIN | upcoming exams w/ room/seat |
| PATCH | `/students/{id}` | ADMIN | status change etc. |

## Faculty

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/faculty` | ADMIN | — |
| GET | `/faculty/{id}/assignments` | self or ADMIN | list of `faculty_subject_batch_assignment` rows |
| POST | `/faculty-assignments` | ADMIN | `{faculty_id, subject_id, batch_id, academic_year, semester, role}`; `409` dup |
| DELETE | `/faculty-assignments/{id}` | ADMIN | soft — sets an end date, does not hard-delete if historical quizzes reference it |

## Subjects

| Method | Endpoint | Auth |
|---|---|---|
| POST/GET/PATCH | `/subjects` | ADMIN write, any authenticated read |

## Enrollment

| Method | Endpoint | Auth | Request | Errors |
|---|---|---|---|---|
| POST | `/enrollments` | ADMIN, FACULTY | `{student_id, subject_id, batch_id, academic_year, semester}` | `409` dup (BR-004) |
| POST | `/enrollments/bulk` | ADMIN | array or CSV | async, per-row result |
| PATCH | `/enrollments/{id}` | ADMIN | `{status}` (e.g. DROPPED) | `404` |
| GET | `/students/{id}/enrollments` | self/ADMIN/teaching FACULTY | — |

## Quiz

| Method | Endpoint | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/quizzes` | FACULTY | `{title, subject_id, batch_ids[], duration_minutes, total_marks, question_count, instructions, quiz_type, preferred_date, preferred_time, academic_year, semester}` | `201`, status=DRAFT | `403` not assigned (BR-010) |
| PATCH | `/quizzes/{id}` | FACULTY (owner/co-instructor) | partial; requires `If-Match: version` | `200` | `409` version mismatch |
| POST | `/quizzes/{id}/submit` | FACULTY (owner) | — | status→SUBMITTED | `422` incomplete, `403` reauthorization fails |
| POST | `/quizzes/{id}/approve` | ADMIN | — | status→APPROVED | `403` if actor is the creator (BR-014), `409` version mismatch (EC-047) |
| POST | `/quizzes/{id}/reject` | ADMIN | `{reason}` | status→REJECTED | `422` missing reason (BR-003/BR-012) |
| GET | `/quizzes` | scoped by role | filters: `status, subject_id, faculty_id` | paginated | — |
| GET | `/quizzes/{id}/approval-history` | ADMIN, owning FACULTY | — | full append-only list | — |

## Exam Sessions

| Method | Endpoint | Auth | Request | Errors |
|---|---|---|---|---|
| POST | `/exam-sessions` | ADMIN | `{name, session_date, start_time, end_time}` | — |
| PATCH | `/exam-sessions/{id}/quizzes` | ADMIN | `{add: [quiz_id...], remove: [quiz_id...]}` | `409` with structured `details[]` on HARD conflict (student/room/faculty overlap, unapproved quiz — BR-011, BR-017–020) |
| POST | `/exam-sessions/{id}/reschedule` | ADMIN | `{session_date, start_time, end_time}` | `409` on new conflicts (EC-021). Notifies assigned students and, once per faculty member, every invigilator (`EXAM_SESSION_RESCHEDULED`, `as_invigilator: true`, rooms listed) |
| ~~POST~~ | ~~`/exam-sessions/{id}/cancel`~~ | — | **Removed.** Sessions are no longer cancelled directly; faculty request a suspension and an admin approves it (see *Suspension Requests* below). | — |
| GET | `/exam-sessions/{id}` | scoped | full detail incl. quizzes, rooms, status | — |
| GET | `/exam-sessions/{id}/conflicts` | ADMIN | dry-run check without committing | returns HARD/WARNING list |

### Suspension Requests

A faculty owner/co-instructor asks to suspend (cancel) a session they no longer need to conduct; an admin decides. **Approval** runs the cancellation that `/cancel` used to do — in the same transaction it marks the request APPROVED — so the session becomes `CANCELLED` (shown under History), its quizzes/rooms/invigilators are released, seating plans are superseded, and assigned students and invigilators are notified. **Rejection** leaves the session untouched. At most one `PENDING` request per session (partial unique index).

| Method | Endpoint | Auth | Request | Errors |
|---|---|---|---|---|
| POST | `/exam-sessions/{id}/suspension-request` | FACULTY (owner/co-instructor) | `{reason}` — 10–2000 chars | `404` not your session, `403` no faculty record, `409` session already IN_PROGRESS/COMPLETED/CANCELLED or a request is already pending |
| GET | `/suspension-requests` | scoped | query: `status`, `exam_session_id`, `cursor`, `limit` — ADMIN sees all, FACULTY only their own; newest first | — |
| POST | `/suspension-requests/{id}/approve` | ADMIN | `{note?}` | `409` already reviewed, or the session has since started/finished (nothing changes) |
| POST | `/suspension-requests/{id}/reject` | ADMIN | `{note}` — required, shown to the faculty | `400` missing note, `409` already reviewed |

Notifications: `SUSPENSION_REQUESTED` → every ADMIN; `SUSPENSION_APPROVED` / `SUSPENSION_REJECTED` → the requesting faculty (with the admin's note).

## Student Assignment

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/exam-sessions/{id}/assign-students` | ADMIN (system-triggered on session progression) | derives eligible students from enrollment; **async** for large cohorts, `202 {job_id}` |
| GET | `/exam-sessions/{id}/roster` | ADMIN, FACULTY (own quiz) | paginated |
| POST | `/exam-sessions/{id}/roster/{student_id}` | ADMIN | manual add (late/waitlist) — triggers re-plan if seating finalized (EC-015) |
| DELETE | `/exam-sessions/{id}/roster/{student_id}` | ADMIN | `{reason}` — cancels assignment (EC-016) |

## Rooms

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST/GET/PATCH | `/rooms` | ADMIN write, any read | incl. seat map management sub-resource `/rooms/{id}/seats` |
| POST | `/rooms/{id}/availability-blocks` | ADMIN | `{date, start_time, end_time, reason}` |
| GET | `/rooms/available` | ADMIN | query `{date, start_time, end_time, min_capacity}` |

## Room Allocation

| Method | Endpoint | Auth | Errors |
|---|---|---|---|
| POST | `/exam-sessions/{id}/rooms/allocate` | ADMIN | body `{room_ids[]}` or `{auto: true, candidate_room_ids[]}` for algorithmic best-fit. With 2+ subjects in 2+ rooms, students are split so every room used holds a mix of every subject (rooms loaded in proportion to size, fewest rooms that fit); one subject or one room uses Best-Fit Decreasing | `409` capacity shortfall (EC-011), room conflict (BR-018) |

## Seating

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/exam-sessions/{id}/seating/generate` | ADMIN | body `{room_id, strategy, skip_alternate_columns?, constraints: {...}}` (`skip_alternate_columns: true` leaves every second column empty; 409 if the students no longer fit; same field on `/seating/regenerate`). One-subject rooms get a roll-number/batch/staggered-row spread, reported as `fallback_reason: SINGLE_SUBJECT_SPREAD`; **async**, `202 {job_id}`; idempotency-key required (EC-032) |
| GET | `/seating-jobs/{id}` | ADMIN | status + result summary (soft_constraint_score, violations) |
| GET | `/seating-plans/{id}` | ADMIN, FACULTY (invigilating that room), STUDENT (own seat only, via `/students/{id}/schedule`) | full plan; student-facing view is filtered to their own row only |
| POST | `/seating-plans/{id}/finalize` | ADMIN | `409` if HARD violations remain (BR-026) |
| POST | `/seating-plans/{id}/swap` | ADMIN | `{student_a_id, student_b_id}` manual override, audited |

## Invigilation

| Method | Endpoint | Auth | Errors |
|---|---|---|---|
| POST | `/exam-sessions/{id}/invigilators` | ADMIN | `{room_id, faculty_id, role}` | `409` overlap (BR-031). Notifies the assigned faculty (`INVIGILATOR_ASSIGNED`); removing the assignment sends `INVIGILATOR_REMOVED`; cancelling the session sends `INVIGILATOR_REMOVED` (cause `SESSION_CANCELLED`) to every invigilator |
| GET | `/faculty/{id}/invigilation-duties` | self/ADMIN | — |

## Attendance

| Method | Endpoint | Auth | Request | Errors |
|---|---|---|---|---|
| POST | `/exam-sessions/{id}/attendance` | FACULTY (invigilator-of-record) | `{student_id, status, method}` | `409` duplicate (BR-033), `422` session not IN_PROGRESS (BR-032), `404` not assigned |
| PATCH | `/attendance/{id}` | FACULTY/ADMIN | `{status, reason}` | `423 Locked` if reason missing post-lock (BR-035) |
| GET | `/exam-sessions/{id}/attendance` | ADMIN, FACULTY (own room) | paginated | — |
| GET | `/students/{id}/attendance-history` | self/ADMIN | — |

## Incidents

| Method | Endpoint | Auth | Request | Errors |
|---|---|---|---|---|
| POST | `/incidents` | FACULTY | `{exam_session_id, quiz_id?, student_id?, room_id?, seat_id?, incident_type, severity, description, evidence_metadata?}` | `422` missing required fields |
| PATCH | `/incidents/{id}/status` | ADMIN | `{action: INVESTIGATE\|ESCALATE\|RESOLVE\|DISMISS, resolution?, notes?}` | `422` resolution required for RESOLVE/DISMISS |
| GET | `/incidents` | ADMIN (all), FACULTY (own reported) | filters: `status, severity, exam_session_id` | — |
| GET | `/incidents/{id}/history` | ADMIN | — | — |

## Notifications

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/me/notifications` | self | paginated, own inbox only |
| PATCH | `/me/notifications/{id}/read` | self | — |

## Reports

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/reports/attendance` | ADMIN | body `{exam_session_id, format}`; **async**, `202 {job_id}` → signed URL delivered via notification |
| POST | `/reports/seating-plan` \| `/reports/incident-report` \| `/reports/room-utilization` | ADMIN | same async pattern |
| GET | `/report-jobs/{id}` | ADMIN | status + download URL when ready |

## Audit

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/audit-logs` | ADMIN | filters: `entity_type, entity_id, actor_id, date_range`; paginated, read-only |

---

## Cross-Cutting Rules

- **Pagination**: cursor-based everywhere (`next_cursor` in response, opaque token) — never offset pagination on tables that can exceed ~10K rows (students, attendance, audit_logs, notifications).
- **Filtering**: bracket syntax `filter[status]=APPROVED&filter[subject_id]=...`, AND-combined.
- **Idempotency**: required on POST for quiz submit/approve/reject, session quiz attach, room allocation, seating generation, attendance create, bulk import, report generation.
- **Validation**: every request body schema-validated at the edge (400/422 on shape errors) AND business-rule-validated in the service layer (409/422 on rule violations) — the two are distinct failure classes and must not be conflated.
- **Authorization**: every endpoint listed above enforces both role-level (RBAC) AND resource-level (ownership/scope) checks server-side; no endpoint relies on the client to have filtered results correctly.
