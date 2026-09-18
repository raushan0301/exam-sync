# ADR-008: RBAC + Mandatory Resource-Level Authorization on Every Endpoint

# Decision
Every API endpoint enforces two independent checks server-side: (1) role-level (does this role have permission to call this endpoint at all) and (2) resource-level (does this specific actor have rights to this specific resource instance). Role-level checks use a declarative guard (framework middleware); resource-level checks are implemented as explicit service-layer queries scoped by actor identity — never inferred from a client-supplied ID, and never satisfied by role-level checks alone.

# Context
The architecture review was asked to identify security/authorization weaknesses. The original design (ARCHITECTURE.md §AF, BUSINESS_RULES.md "Authorization" section) states the rules but the *mechanism* for guaranteeing resource-level checks are never skipped needed explicit architectural treatment — role-level RBAC alone is a well-known insufficient control in exactly this domain shape (a FACULTY role can legitimately call `GET /quizzes/{id}`, but only for quizzes they own/co-instruct — role membership says nothing about which specific quiz).

# Problem
Confirm the architecture cannot silently degrade into "role-level only" enforcement, which would allow e.g. any FACULTY to read any other FACULTY's DRAFT quiz, or any STUDENT to read another STUDENT's attendance, by simply guessing/incrementing an ID (IDOR — insecure direct object reference, the single most common real-world failure mode for this class of system).

# Options
**A. Role-level RBAC only**, relying on frontend to only request "your own" resources. Rejected outright — this is the exact anti-pattern AGENT_DEVELOPMENT_RULES.md rule 6 prohibits (critical rules only in frontend), and is a textbook IDOR vulnerability.
**B. Role-level guard + resource-level check duplicated ad hoc in each controller/service method.** Works but is fragile — easy to forget on a new endpoint, hard to audit for completeness.
**C. Role-level guard + a mandatory, structurally-enforced resource-level authorization layer** — every service method that reads/writes a specific entity must go through a scoping function (e.g., `assertCanAccess(actor, resourceType, resourceId)`) that is either called automatically (via a decorator/interceptor pattern tied to the entity type) or whose absence is caught by a lint rule / required code-review checklist item.

# Decision Rationale: C
- B is what most systems ship with, and it's exactly why IDOR remains one of the most common production vulnerabilities — "remember to add the check" does not scale as a security control across 20+ modules and 60+ endpoints.
- C converts "remember to check" into "the check is structurally part of accessing the resource" — e.g., every repository/service method that fetches a `Quiz`, `Student`, `Attendance`, etc. by ID takes the authenticated actor as a required parameter and applies the scoping predicate as part of the query itself (e.g., `WHERE id = $1 AND (created_by = $actor OR $actor.role = 'ADMIN' OR ...)`), so a missing check produces a 404 (resource "not found" from the actor's perspective) by default rather than an accidental full-table access.

# Trade-offs
- C requires more upfront framework/base-class design work (a shared "scoped repository" pattern) — a real cost in Phase 1, but it is exactly the kind of cost that is cheap early and extremely expensive to retrofit after 20 modules exist with inconsistent per-method checks (matches AGENT_DEVELOPMENT_RULES.md rule 19's "small incremental changes" spirit — get the pattern right once, reuse it everywhere).
- "Fail closed to 404" is the right default for privacy (doesn't confirm a resource exists to an unauthorized actor) but must be applied consistently — a mix of 403-for-some-endpoints and 404-for-others is itself an information leak (which behavior reveals whether resource-level or role-level failed) and should be standardized project-wide.

# Consequences
- Phase 1 (Auth + RBAC) must deliver the scoped-repository/authorization-interceptor pattern as a reusable base, not just the role-guard — this is a scope addition to Phase 1's IMPLEMENTATION_PLAN.md description, made explicit by this ADR.
- Phase 22 (Security Hardening) must include an exhaustive endpoint-by-endpoint audit confirming every entity-fetching endpoint uses the shared scoped-access pattern, not a bespoke check — already implied by IMPLEMENTATION_PLAN.md Phase 22, now given a concrete mechanism to audit against.

# Implementation Notes
- Standardize: unauthorized existence-hiding cases → 404; authorized-but-forbidden-action cases (e.g., a co-instructor trying to approve their own quiz, which is a role-level prohibition regardless of resource ownership) → 403. Document this distinction once, apply it everywhere.
- Every new module added after Phase 1 must be reviewed against this pattern before merge — add it explicitly to AGENT_DEVELOPMENT_RULES.md's REVIEW step checklist.
