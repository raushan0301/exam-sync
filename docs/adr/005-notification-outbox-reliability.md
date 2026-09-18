# ADR-005: Transactional Outbox for Notification Reliability

# Decision
All notification-triggering domain events write a `notifications` row in the same database transaction as the triggering change (transactional outbox pattern); a separate relay process publishes to the queue; delivery is at-least-once with an idempotency key making it effectively-once from the user's perspective.

# Context
The requirement explicitly prohibits synchronous notification sending at 10K+ scale and requires retry, backoff, idempotency, failure tracking, and a dead-letter queue. This is a correctness-of-delivery question, not just a performance one: a naive "publish to queue inside the request handler" approach can silently drop a notification if the DB commit succeeds but the queue publish fails (or vice versa — publish succeeds but the surrounding transaction rolls back for an unrelated reason).

# Problem
Guarantee that a domain event which should notify someone (e.g., "seat assigned") reliably results in exactly one delivered notification, even under partial failures (DB fine, queue down; queue fine, DB rollback; worker crash mid-processing).

# Options
**A. Direct publish-in-request-handler** — simplest, but has the dual-write problem described above (no atomicity between DB commit and queue publish).
**B. Transactional outbox** — write intent to a DB table in the same transaction as the domain change; a separate relay polls/streams that table and publishes; consumer is idempotent.
**C. Change-data-capture (CDC) from the DB write-ahead log** (e.g., Debezium) — even stronger decoupling, avoids polling, but adds a new piece of infrastructure (CDC connector) with its own operational burden.

# Decision Rationale: B
- The dual-write problem is the central risk, and B solves it structurally: the notification "intent" is committed atomically with the domain change (BR-042) — there is no window where the domain change succeeds but the notification intent is lost, or vice versa, because they're the same transaction.
- C (CDC) offers marginally better latency/decoupling than polling but introduces a new infrastructure dependency (Debezium + Kafka Connect or similar) that is unjustified at this system's actual notification volume (even 100K students' worth of exam-related notifications is a small stream compared to what CDC pipelines are built for) — this is exactly the kind of "unnecessary distributed infrastructure" the review explicitly warns against adopting preemptively.
- A relay that polls the `notifications` table for `PENDING` rows (short interval, e.g. 1–5s, or triggered via Postgres `LISTEN/NOTIFY` for lower latency without full CDC) is sufficient and keeps the operational surface to "one more background process," not a new infrastructure category.

# Trade-offs
- B introduces a small latency floor (poll interval, or `LISTEN/NOTIFY` near-instant) between domain event and actual dispatch — acceptable, since nothing in the requirements demands sub-second notification delivery.
- The outbox table (`notifications`) grows continuously and must be partitioned/archived (see ADR-002) — already accounted for.
- The relay itself is a single point that, if down, delays all notifications — but does not lose them (rows stay `PENDING` in Postgres, the durable source of truth — EC-035's stated recovery behavior) — this is the correct trade: delay under failure, never loss.

# Consequences
- Every module that needs to notify (quiz approval, seat assignment, session cancellation, incident escalation, etc.) writes to the `notifications` table as part of its own transaction — this is a cross-cutting dependency that must be available from early phases (Phase 8 onward realistically needs it as a stub at minimum; Phase 15 makes it real, per IMPLEMENTATION_PLAN.md's explicit "audit every prior phase's TODO: notify stub" instruction).
- Idempotency key design (`hash(event_type, recipient_id, entity_id, entity_version)`) must be chosen carefully per event type to avoid false-duplicate suppression (e.g., two genuinely distinct "seat changed" events for the same student must not collide) — flagged as an implementation detail requiring care per event type, not a one-size-fits-all hash.

# Implementation Notes
- Priority lanes (critical vs standard, ARCHITECTURE.md §AN) are implemented as separate queue topics/streams consumed by differently-provisioned worker pools, not as a priority field within one queue (simpler backpressure behavior, avoids head-of-line blocking of critical notifications behind a backlog of standard ones).
- DLQ depth > 0 is a Phase 20/23 alerting requirement, not optional — already specified in ARCHITECTURE.md §AP.
