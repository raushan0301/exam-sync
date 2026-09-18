# ADR-003: Concurrency Control for Booking, Assignment, and Finalization Races

# Decision
Use a **tiered concurrency strategy**: (1) database-level unique/exclusion constraints as the ultimate backstop for every hard invariant, (2) row-level locks (`SELECT ... FOR UPDATE`) for check-then-act sequences scoped to a small, identifiable row set (room allocation, invigilator assignment), (3) `SERIALIZABLE` transaction isolation for the Conflict Engine's cross-entity checks (student/session overlap) where the "set of rows to lock" isn't known in advance, and (4) optimistic locking (`version` column) for user-facing edit races (quiz edits, session edits). No distributed lock manager (e.g., Redis-based locks) is used for these — Postgres primitives are sufficient and strictly stronger (transactional).

# Context
ARCHITECTURE.md §AH and BUSINESS_RULES.md name five specific race conditions the architecture review was asked to verify: (a) two users booking the same room, (b) two users assigning the same student, (c) two seating-generation jobs running simultaneously, (d) concurrent exam finalization, (e) concurrent attendance updates. Each has a structurally different shape and needs a matched mechanism — a single blanket "use a lock" answer would be either too weak (races slip through) or too strong (unnecessary serialization hurts throughput, e.g., locking the whole `attendance` table for unrelated students).

# Problem
Verify and formalize the mechanism for each named race, and confirm none can produce a data-integrity violation under concurrent load.

# Options (evaluated per race, not globally — see Rationale)
**A. Database constraints only** (no explicit locking) — relies purely on unique/exclusion constraints catching the violation at commit time; simplest, but the "loser" transaction gets a raw constraint-violation error that must be mapped to a clean 409, and for multi-step logic (e.g., "find best room, then book it"), a constraint alone doesn't prevent wasted work or return a helpful "which room did I lose to" answer.
**B. Row-level pessimistic locks** (`SELECT ... FOR UPDATE`) scoped to the specific contended rows before the check-then-act sequence.
**C. SERIALIZABLE isolation** for the whole transaction, letting Postgres's conflict detection abort one of two concurrently-conflicting transactions.
**D. Application-level distributed lock** (e.g., Redis `SETNX`) around the whole operation.

# Decision Rationale (per race)

| Race | Mechanism | Why |
|---|---|---|
| (a) Two users book the same room | B (row lock on candidate room rows during allocation) + 🔒 exclusion constraint `(room_id, tstzrange)` as backstop | The candidate row set (specific room IDs) is known upfront — pessimistic lock is cheap and precise; the exclusion constraint means even a code path that forgets to lock still cannot corrupt data, just gets a slower/uglier failure instead of a clean 409 |
| (b) Two users assign the same student to the same quiz | A (🔒 `UNIQUE(quiz_id, student_id)`) — no explicit locking needed, the unique constraint alone is sufficient because there's no multi-step "check availability then act" logic here, just an insert that either succeeds or 409s | Simplicity — locking would be pure overhead for a single-row uniqueness check |
| (c) Two seating-generation jobs for the same (session, room) | A (🔒 unique partial index on `seating_plans (exam_session_id, room_id) WHERE status IN ('DRAFT','FINALIZED')`) + idempotency key at the API layer so the second request never even reaches the worker as a duplicate job | The job itself is long-running (async) — locking a row for the duration of a multi-second/minute job is the wrong shape; instead, the *creation* of the DRAFT plan row is the atomic gate, and everything after is safely single-owner |
| (d) Concurrent exam-session finalization | Optimistic lock (`exam_sessions.version`) — finalize requires the caller's last-seen version; concurrent finalize attempts race on the `UPDATE ... WHERE version = $N`, only one succeeds, the other gets 0 rows affected → 409 | Finalization is a user-initiated, infrequent, single-click action — optimistic locking is the standard, low-overhead fit; pessimistic locking a whole session row for the finalize click's duration is unnecessary since conflicts here are rare, not contended |
| (e) Concurrent attendance updates | A (🔒 `UNIQUE(quiz_student_assignment_id)` on `attendance`) for creation; for post-lock *modification*, optimistic-ish via requiring the actor to supply current status + reason, with the write itself being a single-row UPDATE (Postgres row-lock is automatic and sufficient — different students' attendance rows never contend with each other) | Attendance writes are naturally partitioned by `quiz_student_assignment_id` — no two invigilators are ever writing the *same* row concurrently in a legitimate flow, so the "race" that matters is duplicate-creation, which the unique constraint alone fully prevents |

Distributed locks (Option D) are rejected across the board: every one of these races has a natural home in Postgres's own transactional guarantees, and introducing Redis as a *correctness-critical* lock manager would add a failure mode (lock service unavailable, lock expiry misconfiguration) without adding any correctness Postgres doesn't already provide. Redis remains in the architecture purely as a cache/rate-limit store (see ADR on caching), never as a source of truth for locking.

# Trade-offs
- Row-level locks (used for room allocation) create a small window of serialized contention on hot rows during peak scheduling periods — acceptable because room allocation is an infrequent admin action, not a high-QPS student-facing path.
- `SERIALIZABLE` isolation (used narrowly, only for the Conflict Engine's cross-entity student/faculty overlap checks — ARCHITECTURE.md §AH) has a real throughput cost if over-applied; it must be scoped to the minimum necessary statement(s), not wrapped around entire request handlers.
- Optimistic locking surfaces conflicts to the end user as "someone else changed this, please refresh" — correct behavior, but requires the frontend to handle 409 gracefully (not just as a generic error toast) — an explicit frontend requirement, not just a backend concern.

# Consequences
- Every phase in IMPLEMENTATION_PLAN.md touching one of these five races must implement the *specific* mechanism above, not a generic "add a try-catch" — Phase 10 (Conflict Engine) and Phase 12 (Room Allocation) are the highest-scrutiny phases for this reason (already flagged in AGENT_DEVELOPMENT_RULES.md).
- Concurrency tests for all five races must be included per-phase (already specified in IMPLEMENTATION_PLAN.md's Phase 10/12 test notes) and must be run repeatedly (race tests are often flaky under a single run) — this ADR makes that a hard requirement, not a suggestion.

# Implementation Notes
- Map raw Postgres constraint-violation errors (23505 unique_violation, 23P01 exclusion_violation) to clean 409 API responses with structured `details` at a single shared error-mapping layer — do not let raw DB errors leak to API consumers.
- `SERIALIZABLE` transactions must implement retry-on-serialization-failure (Postgres error 40001) at the service layer — a `SERIALIZABLE` conflict is an expected, retryable outcome, not a bug.
