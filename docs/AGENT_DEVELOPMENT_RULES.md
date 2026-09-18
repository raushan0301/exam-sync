# Exam-Sync — Agent Development Rules (AGENT_DEVELOPMENT_RULES.md)

Binding rules for any coding agent (e.g., Claude Code) implementing this system. These are not suggestions — violating them should be treated as a defect in the work, not a style preference.

## Hard Rules

1. **Read all architecture documents before coding.** At minimum: [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN_MODEL.md](DOMAIN_MODEL.md), [BUSINESS_RULES.md](BUSINESS_RULES.md), [API_CONTRACT.md](API_CONTRACT.md), the relevant phase in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and [OPEN_DECISIONS.md](OPEN_DECISIONS.md) for anything touching an unresolved area.
2. **Never redesign architecture silently.** If a documented approach seems wrong once you're implementing it, stop and raise it explicitly — do not quietly substitute your own design and continue.
3. **Never modify unrelated modules.** A change scoped to the Quiz module should not touch Seating, Notification, or Attendance code unless the task explicitly requires cross-module wiring (e.g., Phase 15's "wire TODO: notify stubs").
4. **Follow the defined domain boundaries** in ARCHITECTURE.md §AW — each module owns its own tables/service layer; cross-module communication goes through service interfaces or domain events, never direct cross-module DB queries.
5. **Never bypass authorization.** Every endpoint requires both role-level (RBAC) and resource-level checks per API_CONTRACT.md and BUSINESS_RULES.md's "Authorization" section, with no exceptions for "internal" or "trusted" callers unless explicitly documented as a system/service-account path.
6. **Never put a critical business rule only in frontend code.** Every rule in BUSINESS_RULES.md must be enforced server-side; frontend validation is a UX convenience layered on top, never the sole gate.
7. **Use database constraints for critical integrity rules.** Anywhere BUSINESS_RULES.md marks a rule 🔒 DB-ENFORCED, implement it as an actual constraint (UNIQUE, CHECK, EXCLUDE, FK) — not solely as an application-layer check that could be bypassed by a direct DB write or a future bug.
8. **Use transactions where required.** Any multi-step domain change (see ARCHITECTURE.md §AI, and every phase's "Backend work" notes) must be atomic — partial application of a multi-row change is a bug.
9. **Make retryable operations idempotent.** Per BR-050, honor `Idempotency-Key` on every endpoint API_CONTRACT.md marks as idempotency-required.
10. **Write tests with every feature.** Each IMPLEMENTATION_PLAN.md phase lists specific test scenarios (often referencing EDGE_CASES.md items by ID) — implement those, not a generic smoke test.
11. **Run tests after changes.** No phase is complete with a red or skipped test suite.
12. **Run lint/type checking where applicable** before considering a change done.
13. **Never introduce a dependency without justification** — state why in the PR/commit description; prefer what's already in ARCHITECTURE.md §AV's recommended stack over adding a new library for a one-off need.
14. **Never change database schema without a migration.** Direct schema edits against a running database, or ORM "auto-sync" in anything beyond local dev, are prohibited.
15. **Never delete production data casually.** Entities with historical significance (departments, subjects, rooms, students, faculty, and anything with `*_history`/`audit_logs`) use soft-delete (`status`/`is_active`), never hard `DELETE`, per ARCHITECTURE.md's stated soft-delete strategy and EC-049.
16. **Never expose unauthorized student/faculty data.** Every list/detail endpoint must be checked against the resource-level rules in BUSINESS_RULES.md "Authorization" and tested against EC-038/EC-039-style attempts, not just the happy path.
17. **Document significant architectural changes.** If a phase's implementation reveals the documented design needs to change, update the relevant `.md` file in the same change, with a note on what changed and why — the docs must stay the source of truth, not drift from reality.
18. **Ask for clarification when requirements conflict with the architecture**, or when an item in OPEN_DECISIONS.md is still `STATUS: OPEN` and the current task depends on its resolution. Do not silently pick an answer to an open product decision.
19. **Prefer small, incremental changes.** Implement and land one phase (or one clearly-scoped slice of a phase) at a time rather than large multi-phase batches — this keeps review tractable and keeps the "independently testable" property from IMPLEMENTATION_PLAN.md real, not nominal.
20. **Do not implement future features unless explicitly requested.** Anything marked FUTURE or COULD HAVE in PRD.md §47, or anything not yet reached in the IMPLEMENTATION_PLAN.md phase order, should not be built preemptively "while I'm in there."

## Standard Workflow for Every Coding Task

```
READ      → Load the relevant docs (rule 1). Identify which BUSINESS_RULES.md IDs,
            EDGE_CASES.md IDs, and API_CONTRACT.md endpoints this task touches.

PLAN      → State the intended approach, files to touch, and test scenarios,
            before writing code. If the plan requires deviating from the
            documented architecture, stop and surface that (rule 2/18) instead
            of proceeding.

IMPLEMENT → Write the smallest change that satisfies the phase's objective and
            acceptance criteria. Respect module boundaries (rule 3/4).

TEST      → Write/extend tests covering the documented scenarios for this
            task (not just new happy-path code). Include the specific
            EDGE_CASES.md and concurrency scenarios called out in the relevant
            IMPLEMENTATION_PLAN.md phase.

REVIEW    → Re-check the change against BUSINESS_RULES.md, the resource-level
            authorization rules, and this document's hard rules before
            considering it done.

FIX       → Address anything found in REVIEW.

VERIFY    → Run the full test suite, lint, and typecheck. Confirm DB migrations
            apply cleanly. Confirm no unrelated files changed (rule 3).

REPORT    → Summarize what changed, which phase/rules/edge-cases it satisfies,
            and flag anything discovered that needs a docs update (rule 17) or
            a product decision (rule 18/OPEN_DECISIONS.md).
```

## Notes for This Specific System

- The Conflict Engine (Phase 10) and Seating Engine (Phases 13/14) are the highest-risk modules — extra scrutiny on concurrency tests and hard-constraint validation is warranted there specifically (see IMPLEMENTATION_PLAN.md's DoD notes for those phases).
- The Phase 8 "stub Conflict Engine" is explicitly flagged in IMPLEMENTATION_PLAN.md as not production-safe until Phase 10 replaces it — do not let this stub reach a real deployment.
- Anywhere OPEN_DECISIONS.md lists a decision as unresolved, the safest default is the most conservative/reversible option (e.g., block rather than auto-allow, require explicit admin action rather than automate) until the decision is formally closed — this avoids building irreversible behavior around a guess.
