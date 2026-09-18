# ADR-007: Incident Disclosure — Architecture Support Decided, Policy Remains Open (DEC-009)

# Decision
The architecture will implement incident visibility as **explicit, per-incident, admin-triggered disclosure** (never automatic), with disclosure state and history tracked as first-class data. This ADR resolves the *engineering* question ("what must the system be capable of") but deliberately does **not** resolve the *policy* question ("should disclosure ever happen, and under what process") — that remains OPEN in OPEN_DECISIONS.md pending institutional/legal input, per this review's own instruction not to silently decide business rules.

# Context
DEC-009 asks whether an accused student should ever see an incident record concerning them. This is not a technical question — it concerns due process, academic integrity procedure, and possibly the institution's legal obligations (e.g., a student's right to know allegations against them before a hearing, which varies by jurisdiction and institutional policy). Engineering cannot responsibly default to "yes, auto-disclose" or "no, never disclose" without that input — but engineering *can* and must decide what the system is technically capable of supporting, so implementation isn't blocked waiting on policy.

# Problem
Without an architectural decision here, Phase 18 (Incident Management) either (a) gets built with an assumption baked in that later proves wrong and requires rework, or (b) stalls entirely waiting for a policy answer that may take longer than the engineering team's schedule allows.

# Options
**A. Build only "never visible to student" (hardcoded)** — simplest, but if policy later requires disclosure (even selectively), this requires schema/API rework, not just a config flip.
**B. Build only "auto-visible once RESOLVED" (hardcoded)** — risks premature/blanket disclosure before policy is confirmed; essentially a guess in the direction with higher harm-if-wrong.
**C. Build the *capability* for explicit, per-incident, admin-triggered disclosure with a full audit trail, but ship with the default policy set to "never disclose" (equivalent in observed behavior to A) until a stakeholder decision changes the default** — the system is policy-configurable at the data/API layer; the actual default behavior is A until told otherwise.

# Decision Rationale: C
- This is the only option that doesn't force a guess on the actual policy question. It adds one field (`incidents.disclosed_at`, `incidents.disclosed_by_admin_id`, nullable) and one explicit admin-only action (`POST /incidents/{id}/disclose`, not built in the initial API_CONTRACT.md — flagged as an addition), rather than hardcoding a visibility rule into every student-facing query.
- Behaviorally, until a stakeholder resolves DEC-009, the system operates identically to Option A (BR-041 stands: incidents are never visible to students by default) — so there is zero risk of premature disclosure while the policy question is pending.
- If the eventual policy is "students should be notified after resolution," or "students should be notified only for certain incident types," or "never," all three are expressible by who calls the disclose action and when — without a schema change. This is the concrete engineering payoff of resolving the *capability* question now even though the *policy* question stays open.

# Trade-offs
- Adds a small amount of unused capability (the disclose action, the tracking fields) if the eventual policy is simply "never disclose" — accepted, because the cost is minimal (a nullable timestamp + one admin action) compared to the cost of retrofitting disclosure capability into a system that assumed it would never be needed.
- Does not resolve DEC-009 itself — Phase 18 can proceed on schedule, but the *disclose* action should not be exposed in any UI or exercised in any workflow until the policy question is answered, since building the capability is not the same as deciding to use it.

# Consequences
- BUSINESS_RULES.md BR-041 is amended: *"Incident records are never visible to the referenced student by default. Disclosure requires an explicit, individually-logged Admin action via the disclosure capability (see ADR-007); until DEC-009 is resolved, this capability must not be exposed in any UI or invoked by any automated workflow."*
- API_CONTRACT.md gains a documented-but-initially-unlaunched endpoint: `POST /incidents/{id}/disclose` (ADMIN only, logged to `incident_history` and `audit_logs`) — implement the data model and endpoint in Phase 18, but gate it behind a feature flag / do not wire it into any student-facing notification path until DEC-009 is closed.
- OPEN_DECISIONS.md DEC-009 remains **OPEN**, explicitly re-scoped: the question is now narrowly "should the disclose capability ever be invoked, by whom, and under what trigger" — not "can the system support disclosure at all" (that part is now resolved by this ADR).

# Implementation Notes
- `incidents.disclosed_at TIMESTAMPTZ NULL`, `incidents.disclosed_by_admin_id UUID NULL FK` — nullable, absent = never disclosed (current, safe default state).
- Student-facing incident queries must check `disclosed_at IS NOT NULL` before returning any incident data referencing that student — this is the enforcement point, and it must be tested (an incident with `disclosed_at IS NULL` must be unreachable via any student-authenticated endpoint, not just hidden in the default UI).
- This capability must ship inert (no code path triggers it automatically) until a signed-off policy exists — treat "building the field" and "wiring the workflow" as two separate, independently-gated pieces of work.
