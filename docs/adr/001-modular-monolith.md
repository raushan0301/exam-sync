# ADR-001: Modular Monolith over Microservices for v1

# Decision
Build Exam-Sync as a single modular-monolith deployable (NestJS-style domain modules, one Postgres database), not microservices.

# Context
The system has ~20 tightly-coupled domains (academic structure, enrollment, quiz, exam session, conflict engine, rooms, seating, attendance, incidents, notifications) that share a dense relational core (see DOMAIN_MODEL.md — most entities are 1–2 hops from `exam_sessions`). Target scale is 10K→100K+ students, which in absolute terms is a modest transactional workload (low hundreds of thousands of rows per busy table, bursty not sustained). Team composition is unspecified but the planning docs assume a single engineering team, not multiple autonomous squads.

# Problem
Should the system be decomposed into independently deployable services from day one, given it must eventually scale to 100K+ students, or should it start as one deployable unit?

# Options
**A. Microservices from v1** — separate services per domain (quiz-service, seating-service, notification-service, etc.), each with its own datastore, communicating via events/gRPC.
**B. Modular monolith** — one deployable, strict module boundaries (own tables, own service layer, communication via in-process service calls or a shared outbox/event mechanism), one Postgres database.
**C. Hybrid** — monolith for most domains, but the seating engine and notification dispatch split out as separate services/workers from day one (they're already the most compute/IO-distinct pieces).

# Rationale for Recommendation: B (Modular Monolith)
- The workload is **relationally dense, not compute-bound**. Splitting `quiz`, `exam-session`, `conflict-engine`, `room`, and `seating` into separate services would force either (a) distributed transactions across the Conflict Engine's cross-entity checks (BR-018/019/020), which is exactly the kind of correctness-critical, low-latency, multi-table check that degrades badly over a network boundary, or (b) a saga/eventual-consistency model for what is currently a single `SERIALIZABLE` transaction — trading a solved correctness problem for a much harder distributed one, with no performance justification (Option A's own throughput isn't the constraint here; consistency is the constraint).
- 100K students is **not** a scale that requires service decomposition on its own. It's a data-volume and read-fanout problem (dashboards, notifications), solvable with read replicas, caching, and stateless horizontal scaling of one app — not a reason to fragment write-path consistency.
- A modular monolith with real module boundaries (own tables per module, no cross-module raw SQL joins, communication through defined service interfaces — ARCHITECTURE.md §AW) preserves the *option* to extract a service later without a rewrite, which is the actual value microservices would offer, obtained here at a fraction of the operational cost.
- Option C (hybrid, extracting seating/notifications early) is close to what we already do at the **process** level — the seating engine's pure functions live in `packages/domain-logic` and run in dedicated worker processes (already async, already horizontally scalable independently of the API tier) — without needing a separate deployable/datastore. This gets Option C's practical benefit without its operational cost, so we don't adopt full service extraction now.

# Trade-offs
- Losing: independent deploy cadence per domain, independent scaling of CPU-heavy pieces at the OS-process boundary (mitigated: workers already scale independently as processes, just not as separate codebases/datastores), fault isolation at the service level (a bug in one module can, in theory, affect the whole app process — mitigated by process-level isolation of workers from the API tier, and by strict module boundaries limiting blast radius of code changes).
- Gaining: one transaction model, one deployment pipeline, far simpler operational surface, faster iteration, no distributed-transaction correctness burden for the Conflict Engine and seating/room booking — which are the parts of this system where a subtle correctness bug has the highest real-world cost (a double-booked room or duplicate seat is a production incident, not a minor bug).

# Consequences
- All 20 domain modules ship in one deployable; module boundary discipline (ARCHITECTURE.md §AW, AGENT_DEVELOPMENT_RULES.md rule 3/4) is the only thing preventing this from degrading into a "big ball of mud" — this must be enforced via code review/lint (e.g., import-boundary linting between `modules/*` directories), not just documentation.
- Workers (`workers/seating-worker`, `workers/notification-worker`, `workers/export-worker`) are already separate deployable processes sharing the same codebase/DB — this is the correct middle ground and should NOT be escalated to separate services/databases without a concrete, measured bottleneck (see ADR-002 on scaling triggers).
- Revisit this decision only if: (a) a specific module's resource profile genuinely diverges (e.g., seating generation needs GPU/specialized compute — not indicated by current design), or (b) organizational scaling requires independent team ownership with independent deploy cadence — neither is true today.

# Implementation Notes
- Enforce module boundaries with a dependency-direction lint rule (e.g., ESLint import boundaries or NestJS module encapsulation) from Phase 0 onward, not retrofitted later.
- Workers remain separate processes/deploy units from the API tier from day one (already specified in ARCHITECTURE.md §AW) — this is the one place "distributed" thinking is warranted now, because it's cheap and already load-bearing for the async design (BR-042).
