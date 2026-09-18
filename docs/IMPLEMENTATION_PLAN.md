# Exam-Sync — Implementation Plan (IMPLEMENTATION_PLAN.md)

No code in this document. Each phase is independently testable and shippable. A coding agent should complete a phase's Definition of Done before starting the next, and must re-read [ARCHITECTURE.md](ARCHITECTURE.md), [BUSINESS_RULES.md](BUSINESS_RULES.md), and [AGENT_DEVELOPMENT_RULES.md](AGENT_DEVELOPMENT_RULES.md) before starting any phase.

---

### Phase 0 — Project Foundation
**Objective**: repo scaffolding, tooling, CI skeleton, empty modular structure per ARCHITECTURE.md §AW.
**Dependencies**: none.
**Features**: n/a.
**DB changes**: initialize migration tooling; no domain tables yet.
**APIs**: health-check endpoint only.
**Frontend work**: app shell, routing skeleton for Admin/Faculty/Student route groups.
**Backend work**: NestJS (or chosen framework) module skeleton matching `apps/api/src/modules/*` structure; DB connection, config management, logging setup.
**Background jobs**: worker process skeleton (no jobs yet).
**Tests**: CI pipeline runs (lint, typecheck, empty test suite) green.
**Security checks**: secret management wired (no secrets in repo), TLS config verified in deploy target.
**Acceptance criteria**: `GET /health` returns 200; CI green on a trivial PR.
**Definition of Done**: repo builds, deploys to a dev environment, CI passes; **import-boundary lint rule between `modules/*` directories is in place and enforced in CI** (see ARCHITECTURE_REVIEW.md §10 item 3 / ADR-001).

### Phase 1 — Authentication + RBAC
**Objective**: users, roles, permissions, login/refresh, role-based guard middleware.
**Dependencies**: Phase 0.
**Database changes**: `users, roles, permissions, user_roles, role_permissions`.
**APIs**: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/users/me`, `/users/{id}/roles`.
**Backend work**: JWT issuance/rotation, password hashing (Argon2id/bcrypt), RBAC guard decorator usable by every future module; **the scoped-repository / resource-level-authorization base pattern (ADR-008)** — every future entity-fetching method must be built on this from Phase 2 onward, so it must exist and be documented here, not added ad hoc later.
**Frontend work**: login screen, auth context/session handling.
**Tests**: auth flow e2e; RBAC guard unit tests (positive + negative per role); brute-force rate-limit test.
**Security checks**: password hashing verified non-reversible; refresh token revocation tested; rate limiting on login verified.
**Acceptance criteria**: a user with role FACULTY cannot call an ADMIN-only endpoint (403); token refresh rotates correctly.
**DoD**: RBAC guard is reusable and documented for all future modules to adopt.

### Phase 2 — Academic Structure
**Objective**: departments, programs, batches, subjects (catalog CRUD).
**Dependencies**: Phase 1.
**DB changes**: `departments, programs, batches, subjects`.
**APIs**: per API_CONTRACT.md "Departments / Programs / Batches" and "Subjects" sections.
**Backend work**: uniqueness constraints (BR-001), status/deactivation logic (BR-003), soft-delete pattern established here as the template for all future entities. **Establish and document the range-partitioning-by-academic_year convention here (ADR-002)** even though no table in this phase needs it yet — Phases 13 (`seating_assignments`), 15 (`notifications`), 17 (`attendance`), and 20 (`audit_logs`) must apply it at table-creation time, not retrofit it.
**Tests**: uniqueness violation returns 409; deactivation blocks new downstream creation (tested once the downstream entity exists — see Phase 5).
**Acceptance criteria**: full CRUD + pagination/search/filter works for all four entities; matches API_CONTRACT.md exactly.
**DoD**: this phase establishes the soft-delete + audit-on-write pattern (Phase 20 wires the actual audit_logs table, but the service-layer hook point must exist from here on).

### Phase 3 — Student Management
**Objective**: student records, bulk import skeleton.
**Dependencies**: Phase 2 (program/batch FKs).
**DB changes**: `students`.
**APIs**: `/students` CRUD, `/students/bulk-import` (async job scaffold — actual queue wiring can be minimal/synchronous here, upgraded in Phase 15).
**Tests**: duplicate roll_number → 409; resource-level auth (student sees only self) stubbed even though enrollment/schedule data doesn't exist yet.
**Acceptance criteria**: matches API_CONTRACT.md "Students" section for CRUD; bulk import handles partial failure per-row (EC-044) even in its minimal form.

### Phase 4 — Faculty Management
**Objective**: faculty records.
**Dependencies**: Phase 2.
**DB changes**: `faculty`.
**APIs**: `/faculty` CRUD.
**Acceptance criteria**: mirrors Phase 3 patterns for faculty.

### Phase 5 — Subject/Batch/Enrollment Mapping
**Objective**: the core many-to-many junctions — `faculty_subject_batch_assignment`, `student_subject_enrollment`.
**Dependencies**: Phases 2, 3, 4.
**DB changes**: both junction tables with their unique constraints (BR-004, BR-009).
**APIs**: `/faculty-assignments`, `/enrollments` (+ bulk variants).
**Backend work**: this phase is where BR-005 (batch membership ≠ eligibility) must be explicitly tested, since it's the most-violated assumption risk in this domain.
**Tests**: duplicate assignment/enrollment → 409; a student's batch membership alone (no enrollment row) correctly yields zero eligible subjects when queried.
**Acceptance criteria**: "Faculty A teaches DBMS to Batch A and B; Faculty B teaches DBMS to Batch C" is representable and queryable (this exact scenario should be a named test case).
**DoD**: this is the highest-leverage phase for correctness — do not proceed to Quiz until this is solid, since every downstream authorization check depends on it.

### Phase 6 — Quiz Management
**Objective**: quiz CRUD + DRAFT/SUBMITTED lifecycle (not yet approval).
**Dependencies**: Phase 5.
**DB changes**: `quizzes, quiz_batches`.
**APIs**: `/quizzes` CRUD, `/quizzes/{id}/submit`.
**Backend work**: BR-010 authorization check against `faculty_subject_batch_assignment`, re-validated at both create and submit; optimistic locking (`version` field, BR-051).
**Tests**: faculty cannot create a quiz for an unassigned subject/batch (403); submit fails on incomplete quiz (422); version-mismatch PATCH returns 409.
**Acceptance criteria**: matches PRD.md FR-016/017 exactly.

### Phase 7 — Admin Approval
**Objective**: approve/reject workflow, approval history.
**Dependencies**: Phase 6.
**DB changes**: `quiz_approval_history`.
**APIs**: `/quizzes/{id}/approve`, `/quizzes/{id}/reject`, `/quizzes/{id}/approval-history`.
**Backend work**: BR-012 (reason required on reject) as a DB CHECK constraint, not just app validation; BR-014 (no self-approval) enforced by role check, not ownership check alone.
**Tests**: reject without reason → 422; faculty attempting to approve their own quiz → 403 even if somehow granted ADMIN role in test setup (defense in depth — test both the role gate and any ownership gate); history is append-only (attempt to update/delete a history row via any code path should be structurally impossible, test via repository-layer inspection).
**Acceptance criteria**: matches PRD.md FR-018–021 (including resubmission, if DEC-011 is resolved in favor of allowing it — otherwise resubmission is deferred).

### Phase 8 — Exam Sessions
**Objective**: session creation, quiz attach/detach, reschedule, cancel.
**Dependencies**: Phase 7.
**DB changes**: `exam_sessions, exam_session_quizzes` — **including the `is_active_attachment` flag + partial unique index enforcing BR-053 (a quiz attaches to at most one non-cancelled session, ADR-006)**; implement the status-change trigger/application discipline that maintains this flag in this phase, not deferred.
**APIs**: `/exam-sessions` family per API_CONTRACT.md.
**Backend work**: BR-011/017 (only APPROVED quizzes attachable); this phase intentionally does NOT yet include conflict detection logic (that's Phase 10) — session creation here can be built against a stub Conflict Engine interface that always passes, to unblock parallel work, then wired for real in Phase 10. **Flag this stub clearly in code comments and do not ship Phase 8 to any real usage without Phase 10 complete.**
**Tests**: attaching an unapproved quiz → 409.
**Acceptance criteria**: session CRUD + quiz attach/detach works against the stub engine.

### Phase 9 — Student Assignment
**Objective**: derive eligible students from enrollment, create `quiz_student_assignment` rows.
**Dependencies**: Phase 8.
**DB changes**: `quiz_student_assignment`.
**APIs**: `/exam-sessions/{id}/assign-students`, roster endpoints.
**Backend work**: eligibility derivation query (BR-005 applied concretely); async job for large cohorts.
**Tests**: a student with `DROPPED` enrollment is excluded; a student in the wrong batch/year/semester is excluded.
**Acceptance criteria**: matches PRD.md FR-026/027.

### Phase 10 — Conflict Engine
**Objective**: replace the Phase 8 stub with the real centralized Conflict Engine (student overlap, room overlap, faculty overlap, capacity, HARD/WARNING/ADMIN_OVERRIDE classification).
**Dependencies**: Phase 9 (needs real assignment data to detect student overlap meaningfully).
**Backend work**: implement all checks from BUSINESS_RULES.md BR-018–020 and ARCHITECTURE.md §Q; wire into session-assembly, reschedule, room-allocation, and invigilator-assignment endpoints, replacing the stub from Phase 8.
**Tests**: this is the highest-risk phase for concurrency bugs — must include the parallel-request test scenarios from EDGE_CASES.md EC-002, EC-014, EC-033.
**Acceptance criteria**: all HARD conflicts from BUSINESS_RULES.md are provably blocked under both sequential and concurrent test conditions; WARNING and ADMIN_OVERRIDE paths function and are audited.
**DoD**: do not proceed to room allocation (Phase 12) until concurrency tests for this phase pass reliably (run them multiple times — race conditions are often flaky, not deterministic).

### Phase 11 — Room Management
**Objective**: rooms, seats, availability calendar.
**Dependencies**: Phase 2 (independent of quiz/session chain, could be built in parallel with Phases 6–10 if team capacity allows).
**DB changes**: `rooms, room_seats, room_availability`.
**APIs**: `/rooms` family.
**Tests**: seat map generation from rows×columns; individual seat disable; availability-block overlap query correctness.

### Phase 12 — Room Allocation
**Objective**: Best-Fit Decreasing allocation algorithm, `exam_session_rooms`.
**Dependencies**: Phases 10, 11.
**DB changes**: `exam_session_rooms` with the exclusion constraint (BR-018).
**APIs**: `/exam-sessions/{id}/rooms/allocate`.
**Backend work**: implement algorithm per ARCHITECTURE.md §S; `SELECT ... FOR UPDATE` on candidate rooms during allocation to prevent races (EC-033-equivalent for rooms).
**Tests**: capacity-shortfall abort (EC-011); concurrent allocation attempts on the same room from two requests — exactly one wins.
**Acceptance criteria**: matches PRD.md FR-029/030.

### Phase 13 — Seating Engine
**Objective**: seat map + strategies (Sequential, Random, Alternate-Subject, Batch Alternation, Subject+Batch Mix) — anti-cheating comes in Phase 14 as it's algorithmically the most complex strategy.
**Dependencies**: Phase 12.
**DB changes**: `seating_plans, seating_assignments`.
**APIs**: `/exam-sessions/{id}/seating/generate`, `/seating-plans/{id}`, `/seating-plans/{id}/finalize`.
**Backend work**: this phase's engine work should be built as pure, framework-independent functions in `packages/domain-logic` (per ARCHITECTURE.md §AW) so it's unit-testable without spinning up the full app; async job wrapper is a thin adapter around it.
**Tests**: HARD constraint enforcement (one student/seat — BR-024/025) under every strategy; FINALIZE blocked when hard violations exist (BR-026).
**Acceptance criteria**: matches PRD.md FR-031/032.

### Phase 14 — Anti-Cheating Constraints
**Objective**: the ANTI_CHEATING strategy (greedy graph-coloring + bounded local repair, per ARCHITECTURE.md §U), soft-constraint scoring and violation reporting, single-subject fallback chain.
**Dependencies**: Phase 13.
**Backend work**: implement per ARCHITECTURE.md §U/§V exactly; the explicit "risk-reduction, not guarantee" disclaimer must be present in both API response and UI copy (FR-034) — treat this as a testable acceptance criterion, not just a doc note.
**Tests**: adjacency-violation counting correctness on known small fixtures (hand-computed expected results); single-subject-room fallback triggers correctly; violation report names the correct seats/students.
**Acceptance criteria**: matches PRD.md FR-033/034; EC-009 and EC-010 scenarios both produce correct, non-silent outcomes.

### Phase 15 — Notifications
**Objective**: transactional outbox, queue, workers, retry/DLQ.
**Dependencies**: can begin in parallel with Phase 8 onward (many prior phases already needed stub notification calls); this phase makes it real.
**DB changes**: `notifications`.
**Backend work**: outbox pattern per ARCHITECTURE.md §AB, wired to every event already referenced (quiz approved/rejected, seat assigned, session cancelled, etc.) — **audit every prior phase's code for a "TODO: notify" stub and wire it here.**
**Tests**: idempotency-key dedup (BR-043); DLQ triggers after exhausted retries; queue-down resilience (EC-035).
**Acceptance criteria**: matches PRD.md FR-041/042; EC-025, EC-026, EC-040, EC-041 all pass.

### Phase 16 — Invigilation
**Objective**: `exam_invigilators`, overlap prevention.
**Dependencies**: Phase 12 (rooms allocated to sessions).
**Tests**: BR-031 overlap check, concurrent-assignment race test.

### Phase 17 — Attendance
**Objective**: manual + seat-based marking, locking, modification history.
**Dependencies**: Phases 13/14 (seating), 16 (invigilator authorization scope).
**DB changes**: `attendance, attendance_history`.
**Backend work**: BR-032/033 validation; auto-lock on session COMPLETED (state-machine side effect, see ARCHITECTURE.md §Y).
**Tests**: duplicate attendance rejected (EC-027); post-lock change requires reason (EC-028); concurrent marks across different students at scale (EC-042).
**Acceptance criteria**: matches PRD.md FR-037/038.

### Phase 18 — Incident Management
**Objective**: incident CRUD, workflow, severity, escalation.
**Dependencies**: Phase 17 (references session/room/seat/student, benefits from attendance existing but not strictly blocked by it — could run parallel to 17).
**DB changes**: `incidents, incident_history`.
**Tests**: CRITICAL severity triggers immediate notification lane (BR-038); status transitions follow the defined workflow only (invalid transition rejected); student non-visibility of incidents by default (BR-041).
**Acceptance criteria**: matches PRD.md FR-039/040.

### Phase 19 — Reporting
**Objective**: async report generation (attendance, seating, roster, incident, room utilization).
**Dependencies**: Phases 15 (async job pattern reused), 17, 18.
**Backend work**: async export jobs, signed URL delivery via notification.
**Tests**: large export doesn't block the request thread; partial data (e.g., report requested mid-session) reflects current state accurately.

### Phase 20 — Audit and Observability
**Objective**: real `audit_logs` table wired into every prior phase's state-changing action; logging/metrics/tracing infrastructure.
**Dependencies**: all prior phases (this is a cross-cutting retrofit + the final wiring pass).
**Backend work**: audit-write-in-same-transaction pattern (BR-048) verified for every mutating endpoint built so far — **this phase should include a checklist audit against every endpoint in API_CONTRACT.md** to catch any that were missed; `audit_logs` table is range-partitioned by academic_year per the Phase 2 convention; **revoke UPDATE/DELETE grants on `audit_logs` at the DB-role level for the application's DB user** (defense in depth for BR-049, ARCHITECTURE_REVIEW.md §5); **add a low-frequency consistency-check job scanning for any quiz attached to more than one non-cancelled session as a BR-053 tripwire** (ARCHITECTURE_REVIEW.md §7).
**Tests**: for a sample of ~10 representative mutating endpoints across different modules, verify an audit row is created atomically with the domain change (test by forcing a post-audit-write failure and confirming full rollback, not a partial commit).
**Acceptance criteria**: matches PRD.md FR-047; no state-changing endpoint in the API contract lacks an audit trail.

### Phase 21 — Performance Optimization
**Objective**: indexing pass, query optimization, caching layer (Redis) for hot reads.
**Dependencies**: all functional phases complete (need real query patterns to optimize against).
**Backend work**: add indexes per ARCHITECTURE.md §AC "Key indexes"; wire read-through cache for dashboards/room layouts with write-invalidation.
**Tests**: p95 latency targets from ARCHITECTURE.md §AL measured under realistic data volume (seed 10K+ students in a test/staging environment).

### Phase 22 — Security Hardening
**Objective**: full RBAC negative-path audit, rate limiting, input validation review, dependency audit.
**Dependencies**: functionally complete system.
**Backend work**: run the resource-level authorization test matrix from BUSINESS_RULES.md "Authorization" section against every endpoint; penetration-test-style review of file upload (incident evidence) path.
**Tests**: every "student accesses another student's data" / "faculty accesses unauthorized batch" class of test (EC-038, EC-039) run exhaustively across all applicable endpoints, not just the ones explicitly listed in API_CONTRACT.md examples.

### Phase 23 — Load Testing
**Objective**: validate scale targets from ARCHITECTURE.md §AK/AT at 10K (required), simulate 50K/100K (projected/extrapolated if full-scale environment isn't available).
**Backend work**: execute the load scenarios named in ARCHITECTURE.md §AT (10K dashboard reads, 10K notification fan-out, 1K concurrent attendance, large seating generation, concurrent room reservation).
**Acceptance criteria**: all scenarios meet their stated targets; any miss is documented with root cause and either fixed or explicitly accepted as a known limitation with a mitigation plan.

### Phase 24 — Production Deployment
**Objective**: production environment stand-up, monitoring/alerting live, backup/restore drill, go-live.
**Backend work**: execute the Production Readiness Checklist in ARCHITECTURE.md §AY in full; confirm all OPEN_DECISIONS.md items are resolved (or explicitly deferred with stakeholder sign-off) before go-live.
**Acceptance criteria**: checklist fully green; rollback plan documented and tested (at minimum, a rehearsed rollback of one recent deploy).
