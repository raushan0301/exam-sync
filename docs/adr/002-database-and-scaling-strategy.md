# ADR-002: Single PostgreSQL Database, Range Partitioning, No Sharding

# Decision
Use a single logical PostgreSQL database (one primary + read replicas), with range partitioning by `academic_year` on the highest-growth tables (`attendance`, `audit_logs`, `notifications`, `seating_assignments`), and explicitly reject sharding for the scale this system targets.

# Context
Target: 10K → 50K → 100K+ students, "no artificial hard limit." The instinct at this stated scale is often to over-provision distributed infrastructure preemptively. The actual write-heavy tables are bounded: even at 100K students with, say, 20 exam sessions/year each sitting 5 quizzes, that's on the order of 10M `attendance` rows/year and a similar order for `seating_assignments` and `audit_logs` — comfortably within single-node PostgreSQL's proven operating envelope (tables with 100M+ rows are routine in production Postgres with correct indexing/partitioning).

# Problem
What database topology correctly serves 100K+ students without either (a) becoming a bottleneck, or (b) adopting unwarranted distributed-database complexity?

# Options
**A. Single Postgres instance, no partitioning** — simplest, works at 10K, risks index bloat and slow archival-adjacent queries at 100K+ over multiple years.
**B. Single Postgres primary + read replicas + range partitioning by academic year on high-growth tables** — scales read capacity horizontally, keeps write-path on one strongly-consistent primary, keeps per-partition indexes small.
**C. Sharded/distributed database (e.g., Citus, or app-level sharding by department/tenant)** — horizontal write scaling, high operational complexity, needed only if a single primary's write throughput is the actual bottleneck.

# Decision Rationale: B
- Write throughput at this scale is bursty (exam windows) but bounded in absolute terms — a single well-indexed Postgres primary handles thousands of writes/sec, far above what even simultaneous 100K-student attendance marking would produce (attendance marking is invigilator-paced, not student-paced — see ADR on attendance concurrency below; it's at most hundreds of concurrent writers, not 100K).
- The actual pain points at scale are (1) **read fanout** (dashboards, 10K+ concurrent students checking schedules) — solved by read replicas + caching, not by sharding the write path; and (2) **long-term table bloat** (`attendance`, `audit_logs`, `notifications` accumulating across years) — solved by range partitioning, which keeps indexes small and makes archival/retention (once DEC-010-equivalent retention policy is resolved) a cheap `DETACH PARTITION` rather than a slow `DELETE`.
- Sharding (Option C) solves a write-throughput problem this system does not have, at the cost of losing cross-shard transactional integrity — which would directly undermine the Conflict Engine's core guarantees (BR-018/019/020 require checking overlaps across potentially any student/room/faculty, i.e., cross-shard by any sharding key you'd choose). Adopting it now would be solving an imaginary bottleneck by breaking a real correctness guarantee.

# Trade-offs
- B requires operational discipline around partition maintenance (creating next year's partition ahead of time, monitoring partition-pruning in query plans) — a real but bounded ongoing cost, not a one-time architecture tax.
- B's read replicas introduce **replication lag** as a new correctness surface: any read that must reflect a just-written state (e.g., an admin re-checking a conflict immediately after resolving one) must read from the primary, not a replica. This must be an explicit routing rule in the data-access layer, not left to chance.

# Consequences
- Data-access layer must support explicit primary-vs-replica read routing (not fully transparent) — flagged as an implementation requirement, not optional.
- Partitioning must be designed into the schema from Phase 0/2 migrations, not retrofitted after data exists (retrofitting a partitioned table under a live system is a major migration).
- Sharding is explicitly out of scope; revisit ONLY if a measured, sustained write-throughput ceiling on the primary is observed in production load testing (Phase 23) — a concrete trigger, not a preemptive choice.

# Implementation Notes
- Partition `attendance`, `audit_logs`, `notifications`, `seating_assignments` by `academic_year` (or a derived date range) from their initial migration.
- PgBouncer (or equivalent) for connection pooling from the 50K-scale stage onward (ARCHITECTURE.md §AK).
- Read-replica routing: dashboard/report queries → replica; anything inside a write transaction or immediately read-after-write (conflict re-checks, EC-046 stale-client scenarios) → primary.
- Establish a load-test-derived scaling trigger document (owned by Phase 23) defining the specific primary-DB metric (e.g., sustained write QPS, CPU, or replication lag threshold) that would justify revisiting this ADR.
