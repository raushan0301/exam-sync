# Exam-Sync — Architecture Review (ARCHITECTURE_REVIEW.md)

Principal Architect review of the completed planning phase, before any implementation begins. Companion documents: [adr/](adr/) (9 ADRs), updated [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Executive Architecture Review

The planning set (PRD, ARCHITECTURE, DOMAIN_MODEL, BUSINESS_RULES, EDGE_CASES, API_CONTRACT, IMPLEMENTATION_PLAN, AGENT_DEVELOPMENT_RULES, OPEN_DECISIONS) is **internally consistent**: every entity in DOMAIN_MODEL.md is backed by a table in ARCHITECTURE.md's schema, every business rule in BUSINESS_RULES.md maps to an API behavior in API_CONTRACT.md and a phase in IMPLEMENTATION_PLAN.md, and every edge case in EDGE_CASES.md resolves to a documented mechanism rather than an unaddressed gap. No orphan concepts, no contradictory states, and no impossible relationships were found.

The architecture's core stance — **modular monolith, single PostgreSQL database, Postgres-native concurrency control, transactional outbox for notifications, greedy-plus-validated-constraint seating** — is sound for the stated scale (10K→100K+ students) and correctly avoids premature distributed-systems complexity (no microservices, no sharding, no distributed locking) while preserving the ability to extract services later if a genuine, measured need arises.

One genuine correctness gap was found and closed (DEC-012 → ADR-006: a quiz could technically double-attach to two sessions). One decision was incorrectly at risk of being engineering-decided by default (DEC-009, incident disclosure) — this review separates the engineering-capability question (now resolved) from the policy question (correctly kept open, with an explanation of why it must stay open).

**Overall verdict: architecturally ready to hand to a coding agent, subject to the prerequisites in §12.**

## 2. Decisions Resolved (this review)

| ID | Decision | ADR |
|---|---|---|
| DEC-012 | Quiz may attach to at most one non-cancelled exam session | [ADR-006](adr/006-quiz-single-active-session.md) |
| DEC-009 (engineering scope only) | Disclosure capability architecture defined (nullable fields, admin-only action, fully audited); ships inert | [ADR-007](adr/007-incident-disclosure-architecture.md) |
| — | Modular monolith confirmed over microservices | [ADR-001](adr/001-modular-monolith.md) |
| — | Single Postgres + partitioning confirmed over sharding | [ADR-002](adr/002-database-and-scaling-strategy.md) |
| — | Concurrency mechanism formalized per race type (no distributed locks) | [ADR-003](adr/003-concurrency-and-booking-races.md) |
| — | Seating hard/soft constraint model and controlled-failure guarantee formalized | [ADR-004](adr/004-seating-engine-constraint-model.md) |
| — | Notification reliability mechanism (transactional outbox) confirmed over CDC/direct-publish | [ADR-005](adr/005-notification-outbox-reliability.md) |
| — | RBAC must be paired with structurally-enforced resource-level authorization (IDOR prevention) | [ADR-008](adr/008-rbac-resource-level-authorization.md) |
| — | Redis scope bounded to cache/rate-limit only, never a source of truth or lock manager | [ADR-009](adr/009-caching-strategy.md) |

## 3. Decisions Still Open

See [OPEN_DECISIONS.md](OPEN_DECISIONS.md)'s priority table. The one requiring genuine stakeholder (not engineering) judgment and flagged highest priority: **DEC-009's policy scope** — whether/when the now-built disclosure capability should ever be exercised. This is a due-process/academic-integrity policy question; deciding it unilaterally in engineering would be exactly the kind of silent business-rule invention this review was instructed to avoid. All other open items (DEC-001–008, 010, 011) have safe, documented defaults and do not block implementation start.

## 4. Critical Architectural Risks

1. **Module-boundary erosion in a monolith.** Nothing physically stops a developer from importing across module boundaries in a modular monolith — the discipline is enforced by convention + lint, not by network/deployment separation. Mitigation: import-boundary lint rule from Phase 0 (ADR-001).
2. **Resource-level authorization inconsistency.** The single highest-likelihood real-world vulnerability class for this system shape is IDOR (role-correct, resource-wrong access). Mitigation: structurally-enforced scoped-access pattern (ADR-008), not ad hoc per-endpoint checks.
3. **Seating engine silent-invalidity risk.** Explicitly tested for and mitigated (ADR-004) via independent post-generation validation — but this guarantee depends on the validator genuinely being independent code, not sharing state with the generator; a future refactor that "optimizes" by merging them would reintroduce the risk. Flagged for ongoing code-review vigilance, not just initial build.
4. **Notification dual-write risk if the outbox pattern is bypassed "for convenience."** A future developer adding a new event type might be tempted to `publish()` directly instead of writing to the outbox — this must be structurally discouraged (e.g., no direct queue-client access outside the outbox-relay module).

## 5. Security Risks

- IDOR (see Critical Risk #2) — primary mitigation ADR-008.
- Incident evidence upload path (file/photo attachments) is a classic injection/malware vector if not handled via pre-signed URLs + virus scan exactly as specified in ARCHITECTURE.md §AG — Phase 22 must verify actual implementation matches spec, not just that an upload endpoint exists.
- Self-approval bypass risk on the Quiz approval flow: BR-014 must be enforced by role check, not merely "faculty ownership ≠ current actor" — a faculty member who is *also* granted ADMIN (future multi-role scenario) must still be blocked from approving their own quiz. Recommend an explicit test: same user ID, both roles, approve-own-quiz attempt → 403 regardless of role check ordering.
- Audit log integrity: BR-049 (append-only) is a design intent but needs a technical backstop — recommend revoking UPDATE/DELETE grants on `audit_logs` at the database-role level for the application's DB user, not just omitting those code paths (defense in depth against a future bug or compromised app credential).

## 6. Scalability Risks

- Determined NOT to require additional infrastructure at any of the three target scales, given the actual bottleneck is read-fanout and long-term table growth, not write throughput (ADR-002). Concretely:
  - **10K students**: single Postgres primary + 1 replica, 2–3 app nodes, Redis, one queue — sufic ient as originally specified.
  - **50K students**: add PgBouncer, more read replicas, more app/worker nodes (all stateless horizontal scaling) — no new infrastructure *category*.
  - **100K+ students**: range partitioning becomes load-bearing (not optional) for `attendance`/`audit_logs`/`notifications`/`seating_assignments`; this must be in the schema from initial migration (ADR-002), not retrofitted.
- **Real risk**: partitioning retrofitted late. If Phase 2's initial migrations don't partition these tables from day one, doing so once the system is live and these tables have grown is a major, risky migration. This is the single scalability item that must not be deferred.
- **Read-replica lag correctness risk**: any workflow with an immediate read-after-write requirement (conflict re-check, EC-046 stale-client reconciliation) must route to the primary — if this routing rule is missed anywhere, a user could see stale data and make a decision based on it (e.g., approve a quiz believing a conflict was resolved when the replica hasn't caught up). Flagged as an implementation-discipline risk, not an architecture gap (ADR-002 already specifies the correct routing rule).

## 7. Data-Integrity Risks

- All primary structural risks (double-booking, double-seating, duplicate attendance/enrollment/assignment) are already DB-constraint-enforced per BUSINESS_RULES.md's 🔒-marked rules — this is correctly designed, not merely asserted.
- The one gap found and closed: quiz double-session-attachment (DEC-012 → ADR-006, now BR-053).
- Residual risk: the cross-table nature of BR-053's enforcement (denormalized `is_active_attachment` flag maintained by trigger/application discipline) is slightly weaker than a pure single-table constraint — recommend a periodic consistency-check job (cheap, low-frequency) that scans for any quiz attached to >1 non-cancelled session as a backstop against a missed trigger/application bug, logged as an alert if found (should never fire if the primary mechanism works, but costs little to have as a tripwire).

## 8. Concurrency Risks

All five named race conditions (room booking, student assignment, concurrent seating generation, concurrent finalization, concurrent attendance) have a specific, matched mechanism (ADR-003) — no single blanket lock, no distributed lock manager. Residual risk is entirely in **test coverage discipline**: these mechanisms are only as good as the concurrency tests that verify them, and race-condition tests are inherently flaky under a single run. IMPLEMENTATION_PLAN.md Phase 10/12 already flag this; this review reinforces it as a release gate, not a nice-to-have (see §12).

## 9. Performance Risks

- Synchronous vs. async boundaries are correctly drawn (ARCHITECTURE.md §AL) — seating, notifications, exports, bulk operations are all async; nothing performance-sensitive is placed on a synchronous critical path inappropriately.
- Risk: the Conflict Engine's cross-entity checks (session assembly, reschedule) run synchronously and use `SERIALIZABLE` isolation (ADR-003) — this is correct for correctness but must be scoped tightly (minimum necessary statements) or it becomes a latency/throughput risk under concurrent admin usage. Flagged as an implementation-discipline item for Phase 10, not a design flaw.

## 10. Recommended Changes

1. Add BR-053 (quiz single-active-session) to BUSINESS_RULES.md — done, see ADR-006.
2. Add the incident-disclosure fields/endpoint to the relevant schema/API docs ahead of Phase 18, shipped inert — done, see ADR-007.
3. Add an import-boundary lint rule to Phase 0's Definition of Done (ADR-001) — **action item for IMPLEMENTATION_PLAN.md Phase 0**, not yet reflected there; recommend updating Phase 0's DoD line to explicitly mention it.
4. Add the scoped-repository/resource-authorization base pattern to Phase 1's scope explicitly (ADR-008) — **action item for IMPLEMENTATION_PLAN.md Phase 1**.
5. Add partitioning to Phase 2's migration scope explicitly for the four identified tables (ADR-002) — note: `attendance`, `notifications`, `seating_assignments` don't exist until later phases (17, 15, 13 respectively) create their tables; the *partitioning strategy* must be decided now (Phase 2, as a documented schema convention) and applied when each table is actually created in its respective phase, not bolted on afterward. **Action item: add a note to Phases 13/15/17's DB-changes sections referencing this convention.**
6. Add a periodic consistency-check job for BR-053 as a defense-in-depth tripwire (§7) — minor addition to Phase 8 or Phase 20 (Audit/Observability) scope.
7. Explicitly revoke UPDATE/DELETE grants on `audit_logs` at the DB-role level (§5) — add to Phase 20's acceptance criteria.

## 11. Architecture Approval Checklist

- [x] All planning documents cross-reference consistently (PRD ↔ Domain Model ↔ Database ↔ API ↔ State Machines ↔ Business Rules ↔ Implementation Plan)
- [x] Every HARD business rule has a stated DB-enforcement mechanism
- [x] Every named race condition has a specific, justified concurrency mechanism
- [x] Seating engine's hard/soft distinction and controlled-failure guarantee is architecturally verified, not just asserted
- [x] Notification reliability mechanism avoids the dual-write hazard
- [x] RBAC is paired with a structural (not ad hoc) resource-level authorization mechanism
- [x] Scalability plan is justified by actual bottleneck analysis (read-fanout + table growth), not by default over-provisioning
- [x] No sharding, no distributed locking, no premature service extraction — all explicitly justified as unnecessary at this scale
- [x] DEC-012 resolved; DEC-009 correctly split into resolved-engineering / open-policy
- [ ] **Remaining before code starts**: the six §10 action items are reflected back into IMPLEMENTATION_PLAN.md's phase descriptions (currently only documented here and in the ADRs — a coding agent reading IMPLEMENTATION_PLAN.md in isolation would miss them unless it also reads this review and the ADRs, which AGENT_DEVELOPMENT_RULES.md rule 1 already mandates, but a direct cross-reference note in the plan itself is safer)

## 12. Exact Prerequisites Before Coding Begins

1. Stakeholder sign-off is **not required** to begin Phase 0–1 — no open decision blocks foundational work.
2. Before Phase 2 (Academic Structure) migrations are written: confirm the partitioning convention (§10 item 5) is understood by whoever writes those migrations, even though the partitioned tables themselves come later.
3. Before Phase 8 (Exam Sessions): BR-053 / ADR-006's mechanism must be implemented as part of the `exam_session_quizzes` migration, not deferred.
4. Before Phase 10 (Conflict Engine) is considered complete: all five concurrency-race tests from ADR-003 must pass under repeated runs (not a single green run) — this is a hard gate, not a soft target.
5. Before Phase 14 (Anti-Cheating Constraints) is considered complete: a deliberately HARD-infeasible test fixture must be shown to produce `FAILED`, never `FINALIZED` (ADR-004's core guarantee, tested explicitly).
6. Before Phase 18 (Incident Management) ships to any real usage: confirm the disclosure capability (ADR-007) remains un-wired to any live workflow, pending DEC-009's policy resolution — this must be an explicit check in that phase's REVIEW step (AGENT_DEVELOPMENT_RULES.md workflow), not assumed.
7. Before Phase 24 (Production Deployment): DEC-010 (retention policy) should be resolved or explicitly deferred with sign-off — it's not a Phase 0–20 blocker, but shipping to production with genuinely no retention policy at all is a governance gap worth closing before go-live, not after.

No other stakeholder decisions block implementation start. The architecture is ready to hand to a coding agent, beginning at IMPLEMENTATION_PLAN.md Phase 0, subject to the six §10 action items being folded into that document before Phase 0 work starts (a documentation-consistency step, not a design blocker).
