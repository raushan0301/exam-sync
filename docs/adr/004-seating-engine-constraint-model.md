# ADR-004: Seating Engine Hard/Soft Constraint Model and Controlled Failure

# Decision
The seating engine treats seat-assignment validity as two strictly separated constraint classes — HARD (must hold, or the plan cannot reach FINALIZED) and SOFT (preferred, scored, reported, never silently dropped) — implemented as a greedy graph-coloring fill plus a bounded local-repair pass, never a heuristic that can produce an unvalidated result.

# Context
This was called out explicitly as a verification target: "verify that an impossible seating problem produces a controlled failure rather than silently generating an invalid arrangement." ARCHITECTURE.md §T/U/V and BUSINESS_RULES.md BR-024–029 already establish this distinction; this ADR formalizes and stress-tests it as part of the architecture review.

# Problem
Confirm the architecture cannot reach a state where a seating plan is marked usable (FINALIZED) while violating a rule that must never be violated (double-booked seat, unmet accessibility requirement, unmet explicit separation rule).

# Options
**A. Best-effort heuristic, no formal validation gate** — generate a plan, present it; any unsatisfied constraint is just... not flagged. Rejected outright — this is precisely the failure mode the requirements prohibit ("never silently generate an invalid seating plan").
**B. Two-tier constraint model with an explicit validation gate before FINALIZE**, where HARD violations block finalization unconditionally and SOFT violations are computed, reported, and require no special handling to finalize (current design).
**C. Full constraint-satisfaction solver (CSP/ILP) that either finds a fully-satisfying assignment or proves none exists** — mathematically the strongest guarantee, but computationally expensive at 10K+ students and not guaranteed to terminate quickly.

# Decision Rationale: B
- HARD constraints in this domain (BUSINESS_RULES.md BR-024/025/028/029) are all things that are **structurally checkable in isolation** after generation — one seat per student, accessibility match, explicit-pair separation — none require a global optimality proof, just a per-seat/per-pair scan. This means B can offer the *same integrity guarantee* as C (a violated hard constraint is always caught) without C's computational cost, because "verify" is cheap even when "optimally satisfy" would be expensive.
- SOFT constraints (subject/batch/quiz adjacency diversity) are explicitly *not* safety-critical — the requirements state seating is risk-reduction, not a guarantee (FR-034) — so spending CSP/ILP-level computational effort to *optimally* satisfy them is effort spent on the wrong thing. A greedy-fill-plus-bounded-repair heuristic (ARCHITECTURE.md §U) gets "good enough" diversity fast, and the validation gate (not the generation algorithm) is what actually protects correctness.
- Option C is rejected specifically because its failure mode under infeasibility (no solution found) can be computationally *expensive to prove* — a CSP solver might run for a long time before concluding "impossible," which is worse UX and worse resource usage than B's cheap post-hoc scan-and-report.

# The Controlled-Failure Guarantee, Stated Precisely
1. Generation (greedy + repair) always terminates in bounded time (O(n) + O(n·K) for fixed repair-pass count K — ARCHITECTURE.md §U) and always produces *some* seat/student mapping attempt, even a bad one.
2. **Validation is a separate, mandatory step** that runs after generation and before any state transition to VALIDATED: it re-scans every seat/pair for every HARD constraint from scratch (not trusting the generator's own bookkeeping) — this separation is the key integrity property; a bug in the generator's internal constraint-tracking cannot silently produce a FINALIZED plan, because the validator is an independent check against the persisted `seating_assignments` rows.
3. If any HARD constraint fails validation → plan status becomes `FAILED`, never `VALIDATED`/`FINALIZED` (see state machine, ARCHITECTURE.md §AD-2 #4) — this transition is enforced by the state machine itself, not by convention: there is no code path from DRAFT to FINALIZED that skips VALIDATED.
4. The `FAILED` result includes the specific constraint, the specific students/seats involved, and a suggested remediation (add capacity, relax a rule) — never a bare "failed" with no diagnostic.
5. SOFT constraint shortfalls never block FINALIZE, but are always computed and exposed (`soft_constraint_score`, itemized violation list) — "silently generating an invalid arrangement" is prevented for HARD constraints by blocking, and for SOFT constraints by making the shortfall visible rather than hidden (a plan with a low soft score is still valid, but the admin is never left unaware of it).

# Trade-offs
- The greedy+repair heuristic is not guaranteed to find the *best possible* soft-constraint arrangement — a full CSP/ILP might do better in some cases. This is accepted because "risk reduction" doesn't require optimality, only bounded, reported, good-effort diversity, and the cost of near-optimal-but-fast trumps optimal-but-slow at 10K+ scale.
- The bounded repair pass (K iterations) means some fixable soft violations might remain unfixed if K is set too low — this is a tunable parameter, not a structural flaw; K should be validated empirically during Phase 14 testing against realistic room sizes.

# Consequences
- Phase 14's acceptance criteria must include an explicit test fixture that is HARD-constraint-infeasible by construction (e.g., more accessibility-required students than accessible seats) and assert the plan reaches `FAILED`, never `FINALIZED`, with a correctly identified violation.
- The validator must be implemented as logic independent from the generator (not sharing internal state) precisely so it functions as a real second check, not a rubber stamp on the generator's own claims.

# Implementation Notes
- Implement generation and validation as two distinct pure functions in `packages/domain-logic` (per ARCHITECTURE.md §AW) so the validator can be unit-tested against hand-constructed `seating_assignments` fixtures independent of ever running the generator.
- The `FINALIZE` API transition (`POST /seating-plans/{id}/finalize`) must re-run validation synchronously at finalize time, not merely trust a previously-computed `VALIDATED` status if any assignment rows could have changed since (defense against EC-047-style staleness).
