# ADR-009: Redis Scope — Cache and Rate-Limit Only, Never Source of Truth

# Decision
Redis is used exclusively for (1) read-through caching of low-churn, high-read data (room layouts, finalized seating plans, a student's own upcoming-exam view) with short TTL + explicit write-invalidation, and (2) rate-limiting/session-adjacent counters. Redis never holds data for which it is the only copy, and is never used as a locking/consistency mechanism for correctness-critical operations (see ADR-003).

# Context
The review asked to challenge the Redis/cache design specifically, and to avoid recommending unnecessary distributed infrastructure. The original architecture (ARCHITECTURE.md §AM) already scopes Redis this way but didn't explicitly rule out the tempting shortcut of using Redis for locking or as a fast-path data store during high-load windows (e.g., "cache attendance in Redis during the exam, flush to Postgres after").

# Problem
Confirm Redis's role stays bounded and doesn't become a second source of truth, which would reintroduce consistency problems (cache/DB divergence, data loss on Redis restart/eviction) into exactly the write paths (attendance, seating, booking) where this review is most concerned about integrity.

# Options
**A. Cache-only Redis** (current/recommended) — read-through cache with TTL and write-invalidation, nothing else.
**B. Redis as a write-behind buffer** for high-frequency writes (e.g., attendance marks written to Redis first, flushed to Postgres asynchronously) to reduce DB write load during peak exam windows.
**C. Redis for distributed locking** on booking/seating operations, replacing or supplementing the Postgres-native mechanisms in ADR-003.

# Decision Rationale: A
- B is rejected because this system's actual attendance write volume (ADR-002: at most hundreds of concurrent invigilator writers, not thousands) never approaches a level where Postgres row-level writes are the bottleneck — B would trade Postgres's durability guarantee for a performance gain the system doesn't need, and would reintroduce exactly the "partial failure between two stores" risk this review flags elsewhere (ADR-005's rationale against dual-write applies here too: Redis-then-Postgres attendance writes have the identical dual-write hazard as the notification anti-pattern in ADR-005 Option A).
- C is rejected per ADR-003's rationale: Postgres's own constraints and transaction isolation already provide correctness guarantees strictly stronger than an external lock service (which adds a new failure mode — lock expiry, split-brain on Redis failover — without adding any guarantee Postgres doesn't already have for these specific operations).
- A is sufficient for the system's actual bottleneck, which is **read fanout** (10K+ students hitting dashboards), not write throughput or write-side locking — matching this ADR's scope to the actual, evidenced need rather than a hypothetical one.

# Trade-offs
- A means peak-window read latency depends on cache hit rate; a cold cache (e.g., right after a deploy, or right after a mass schedule-finalization event that invalidates many keys at once) could see a temporary read-latency spike absorbed by read replicas (ADR-002) rather than Redis — this is an acceptable, bounded degradation, not a correctness risk.
- Explicit write-invalidation (rather than TTL-only) adds a small amount of coupling — every write path that changes cached data must remember to invalidate the relevant key(s). This is a known, manageable pattern (not a novel risk), and should be centralized in the same module that owns the underlying entity (e.g., the Seating module invalidates its own seating-plan cache keys) rather than scattered.

# Consequences
- No phase in IMPLEMENTATION_PLAN.md should introduce Redis as a durability-bearing store for attendance, seating, bookings, or any other correctness-critical write path — this ADR is a standing constraint on all future phases, most relevant to Phase 17 (Attendance) and Phase 21 (Performance Optimization), where the temptation to "just cache writes" is most likely to surface under load-testing pressure.

# Implementation Notes
- Cache key invalidation ownership: co-locate invalidation logic with the write path that changes the underlying data (e.g., `SeatingService.finalize()` invalidates `seating:plan:{id}` and any aggregate `student:{id}:schedule` keys it affects) — never a separate, easily-forgotten "cache cleanup" job.
- Rate-limiting counters (login attempts, bulk-operation throttling) are Redis's other legitimate use — these are inherently ephemeral/best-effort by nature (a rate-limit reset on Redis restart is a minor, self-healing issue, not a data-integrity one), which is precisely why they're an appropriate Redis use case and attendance data is not.
