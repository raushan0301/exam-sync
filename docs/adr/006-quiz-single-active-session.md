# ADR-006: A Quiz May Be Attached to At Most One Non-Cancelled Exam Session (resolves DEC-012)

# Decision
Enforce, at the database level, that a quiz can be attached to at most one exam session whose status is not `CANCELLED`, via a partial unique index. This closes the gap identified in OPEN_DECISIONS.md DEC-012 and is added to BUSINESS_RULES.md as **BR-053**.

# Context
DOMAIN_MODEL.md modeled `exam_session_quizzes` as a generic M:N join table, which technically permits the same quiz to be attached to two different exam sessions simultaneously. Nothing in the original requirements ever describes a legitimate scenario where one quiz instance is meant to run in two different sessions at once — every example in the source spec (DBMS/OS/CN combination) shows each quiz attached to exactly one session.

# Problem
An unconstrained M:N join allows an accidental double-scheduling of the same quiz (e.g., an admin attaches "DBMS-QUIZ-4" to Session #1001, and later, through a UI or API misuse, also attaches it to Session #1002) — this would silently produce two separate sets of `quiz_student_assignment`/seating/attendance records for what should be a single exam event, which is a data-integrity defect with no compensating control anywhere else in the architecture.

# Options
**A. Leave unconstrained (M:N as originally modeled)** — maximum flexibility, no protection against accidental double-scheduling.
**B. Enforce at most one *active* (non-cancelled) session per quiz via a DB constraint**, while still allowing a quiz to move from a CANCELLED session to a new one (re-scheduling after cancellation).
**C. Enforce a quiz can only EVER be attached to exactly one session for its lifetime (1:N cardinality, no cancellation-based re-attachment)** — simplest schema (could even become a direct FK instead of a join table) but forecloses the legitimate "session was cancelled, reschedule the same quiz into a new session" flow implied by EC-024's cancellation-then-presumably-reschedule pattern.

# Decision Rationale: B
- B directly closes the identified gap (prevents the accidental double-scheduling defect) while preserving the one legitimate multi-session-over-time scenario the architecture already describes: EC-024 states a cancelled session's children remain historical, and "a new session must be created if rescheduling is intended" — meaning the *same quiz* plausibly needs to attach to a *new* session after its original session was cancelled. C would make that impossible without deleting/mutating historical join rows, which contradicts the append-only/soft-delete philosophy (AGENT_DEVELOPMENT_RULES.md rule 15).
- A is rejected because it leaves the identified defect unaddressed — this is exactly the class of "missing business rule" the architecture review was asked to surface, not merely note and leave open.

# Trade-offs
- B requires the constraint to be partial (`WHERE session.status != 'CANCELLED'`), which means the invariant spans two tables (`exam_session_quizzes` joined against `exam_sessions.status`) — a plain column-level unique constraint on `exam_session_quizzes` alone cannot express this. This requires either (i) a Postgres partial unique index on a materialized/denormalized status-aware column, or (ii) enforcement via a `SERIALIZABLE`-transaction application check at attach-time (same pattern as the Conflict Engine, ADR-003) with a lighter-weight periodic consistency check as a backstop, since a true cross-table partial index isn't directly expressible without denormalization.
- Recommended concrete implementation: denormalize a boolean `is_active_attachment` (or equivalent) onto `exam_session_quizzes`, maintained by the application/trigger whenever the parent session's status changes to/from CANCELLED, with `UNIQUE(quiz_id) WHERE is_active_attachment = true` as the real DB-enforced constraint — this keeps the guarantee DB-level (per AGENT_DEVELOPMENT_RULES.md rule 7) rather than purely application-level.

# Consequences
- BUSINESS_RULES.md gains BR-053: *"A quiz can be attached to at most one non-cancelled exam session at a time. 🔒 DB-ENFORCED via partial unique index on `exam_session_quizzes(quiz_id) WHERE is_active_attachment`."*
- IMPLEMENTATION_PLAN.md Phase 8 (Exam Sessions) must implement this constraint as part of the `exam_session_quizzes` table migration, before Phase 10 (Conflict Engine) is built on top of it — this ADR should be read alongside Phase 8's plan.
- API_CONTRACT.md's `PATCH /exam-sessions/{id}/quizzes` must surface a specific, distinguishable 409 for "quiz already attached elsewhere" separate from the general conflict-list 409, so the UI can present it clearly.

# Implementation Notes
- A Postgres trigger (or application-transaction discipline) must flip `is_active_attachment` to false on the old row when a session is cancelled, and the "attach to new session" flow for a previously-cancelled quiz is then just a fresh insert, unconstrained by the old (now inactive) row.
- Add a migration test asserting the partial unique index actually rejects the double-attach scenario under concurrent attempts (same concurrency-test discipline as ADR-003).

# Status
This decision is **resolved as an engineering/data-integrity fix**, not a product-policy question — no stakeholder input was required, since no version of "the same quiz genuinely running in two simultaneous exam events" is described or implied anywhere in the source requirements. OPEN_DECISIONS.md DEC-012 is marked RESOLVED, referencing this ADR.
