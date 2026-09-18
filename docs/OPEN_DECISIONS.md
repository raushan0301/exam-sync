# Exam-Sync — Open Decisions (OPEN_DECISIONS.md)

Business/product decisions that were **not** silently assumed. Each has a recommended default (used elsewhere in the docs where a placeholder was needed) but requires explicit stakeholder sign-off before the dependent phase ships to production.

**Updated by the Architecture Review — see [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) and [adr/](adr/).**

## Priority Order (post-review)

| Priority | Decision | Status | Blocks |
|---|---|---|---|
| P0 | DEC-012 (quiz/session cardinality) | **RESOLVED** (ADR-006) | Phase 8 — no longer blocked |
| P0 | DEC-009 (incident disclosure) | **OPEN, policy only** — engineering unblocked (ADR-007) | Nothing technical; only whether to *invoke* the disclosure capability |
| P1 | DEC-010 (data retention) | OPEN | Long-term storage cost/compliance; not a Phase 0–20 blocker but should close before Phase 24 |
| P1 | DEC-002 (self-enrollment) | OPEN | Phase 5 UX scope (API already assumes admin/faculty-only; low risk to proceed on that default) |
| P2 | DEC-004 (metadata-edit whitelist) | OPEN | Phase 7 scope refinement; safe to proceed with strictest default (A) if undecided by Phase 7 |
| P2 | DEC-003 (resubmission cap) | OPEN | Phase 7; safe to proceed with unlimited default |
| P3 | DEC-001, 005, 006, 007, 008, 011 | OPEN | Low urgency — safe defaults documented, no phase is blocked |

---

**DEC-001 — Multi-tenancy timeline**
*Question*: Is this single-institution forever, or should multi-tenant support be planned?
*Why it matters*: Retrofitting `tenant_id` onto every table after data exists is a painful migration; adding it now (unused) is nearly free.
*Options*: (A) Single-tenant, no reservation. (B) Reserve `tenant_id` column now, unused. (C) Full multi-tenant from v1.
*Recommended*: (B) — reserve the column, don't build tenant-scoping logic yet.
*Trade-off*: (B) adds a trivial amount of schema noise now to avoid a costly migration later; (C) is premature given the stated single-institution scope.
*Status*: **OPEN**

**DEC-002 — Student self-enrollment**
*Question*: Can students enroll themselves in subjects, or is enrollment always admin/faculty-driven?
*Why it matters*: Affects the `/enrollments` API's authorization model (currently ADMIN/FACULTY-only per API_CONTRACT.md) and whether a student-facing enrollment UI is needed.
*Options*: (A) Admin/Faculty-only (current assumption). (B) Student self-service with admin approval. (C) Fully self-service.
*Recommended*: (A) — matches typical exam-cell-managed registration processes; safest default given no evidence otherwise.
*Trade-off*: (A) may not match the institution's actual registration workflow if students currently self-register elsewhere and this system needs to mirror/import that.
*Status*: **OPEN**

**DEC-003 — Quiz rejection → resubmission cap**
*Question*: Can a rejected quiz be resubmitted unlimited times, or is there a cap?
*Why it matters*: Affects FR-021 and Phase 7 scope; an unbounded resubmission loop could indicate a process problem worth surfacing to admins.
*Options*: (A) Unlimited resubmissions. (B) Capped (e.g., 3) with escalation after. (C) No resubmission — new quiz required.
*Recommended*: (A) for v1 simplicity, with a dashboard indicator if resubmission count exceeds a soft threshold (e.g., 3) for admin visibility, not a hard block.
*Trade-off*: (A) is simplest to build; (B) adds process rigor but is speculative without evidence it's needed.
*Status*: **OPEN**

**DEC-004 — Approved-quiz metadata-only edits**
*Question*: Does editing an APPROVED quiz's non-substantive fields (e.g., fixing an instructions typo) require re-approval, or is it allowed in place?
*Why it matters*: Affects BR-015 and Phase 7/8 scope; overly strict re-approval is friction, overly loose allows silent substantive drift disguised as a "typo fix."
*Options*: (A) Any edit to an APPROVED quiz reverts to DRAFT. (B) A defined whitelist of "metadata" fields (instructions text) can be edited in place, audited but not requiring re-approval; all other fields force revert. (C) No edits allowed post-approval; must cancel and recreate.
*Recommended*: (B) — but the exact field whitelist must be confirmed with the institution's exam-cell process owner before Phase 7 implementation.
*Trade-off*: (B) requires maintaining and justifying a whitelist; (A) is simplest but may create unnecessary re-approval friction for trivial fixes.
*Status*: **OPEN**

**DEC-005 — Who can request combining quizzes into a session**
*Question*: Confirmed in ARCHITECTURE.md §O as "Admin creates/finalizes, Faculty may request" — but the request mechanism itself (a formal API vs. informal communication) isn't specified.
*Why it matters*: If faculty need a first-class "request combination" feature, that's an additional API surface not currently in API_CONTRACT.md.
*Options*: (A) No formal request mechanism — faculty communicate preferences outside the system (e.g., email), admin manually combines. (B) Add a lightweight `POST /quizzes/{id}/request-session` that just tags the quiz for admin attention, no automation beyond that.
*Recommended*: (A) for v1 — avoids building a workflow feature with unclear value until real usage patterns are observed.
*Trade-off*: (A) may feel like a gap to faculty users; (B) is low-cost to add later if demand is confirmed.
*Status*: **OPEN**

**DEC-006 — Faculty invigilation eligibility rules**
*Question*: Are there any restrictions on which faculty can invigilate which rooms (e.g., department affiliation, seniority), or is any active faculty eligible for any room (current assumption)?
*Why it matters*: Affects Phase 16 authorization logic.
*Options*: (A) Any active faculty, admin's discretion (current assumption). (B) Restricted by department/seniority rules.
*Recommended*: (A) — no evidence of a restriction requirement in the source spec.
*Status*: **OPEN** (low urgency — default is low-risk and easily tightened later)

**DEC-007 — Seating adjacency definition**
*Question*: Does "adjacent" for anti-cheating purposes mean 4-directional (left/right/front/back) or 8-directional (including diagonals)?
*Why it matters*: Materially changes the seating engine's graph structure and how "hard" it is to satisfy soft constraints in dense rooms.
*Options*: (A) 4-directional. (B) 8-directional (stricter).
*Recommended*: (A) as the default, exposed as a per-room or per-institution configuration toggle rather than hardcoded, since physical room layouts and desk spacing vary.
*Trade-off*: (B) is a stronger cheating-risk reduction but is harder to satisfy, especially in tightly-packed rooms with few subjects — may produce more soft-constraint violations.
*Status*: **OPEN**

**DEC-008 — Dropped-subject seat handling**
*Question*: When a student drops a subject after seating is finalized (EC-016), should their vacated seat be auto-filled from a waitlist, or left empty?
*Why it matters*: Auto-fill risks last-minute churn (re-notifying a promoted student close to exam time); leaving empty is simpler but wastes capacity.
*Options*: (A) Always leave empty. (B) Auto-fill if a waitlist exists and the drop occurs more than N hours before the exam; leave empty otherwise. (C) Admin decides case-by-case via manual action (EC-015's mechanism, just not automatic).
*Recommended*: (C) — matches the existing manual-add mechanism (EC-015) and avoids building a time-threshold auto-fill policy without confirmed institutional appetite for late reassignment churn.
*Status*: **OPEN**

**DEC-009 — Incident disclosure to the accused student**
*Question*: Does policy require ever disclosing an incident record to the student it concerns, and if so, when/how?
*Why it matters*: This is a fairness/due-process question with real institutional and possibly legal weight (academic integrity proceedings) — must not be silently decided by an engineering default.
*Engineering scope RESOLVED — see [ADR-007](adr/007-incident-disclosure-architecture.md)*: the architecture now supports explicit, per-incident, admin-triggered disclosure (nullable `disclosed_at`/`disclosed_by_admin_id`, a dedicated `POST /incidents/{id}/disclose` endpoint, fully audited) so Phase 18 is NOT blocked. The capability ships inert — no UI or workflow invokes it automatically.
*Policy scope REMAINS OPEN*: whether that capability should ever be exercised, by whom, and under what trigger, requires institutional academic-affairs/legal input — engineering cannot and should not decide this.
*Status*: **OPEN (policy only) — HIGH PRIORITY.** Do not wire the disclosure capability into any live workflow until this is answered. Engineering readiness for either answer is DONE.

**DEC-010 — Data retention period**
*Question*: How long must attendance history, incident records (including evidence), and audit logs be retained?
*Why it matters*: Affects storage/archival design and possibly legal/compliance obligations; retention-then-purge logic isn't in the current design at all (everything is retained indefinitely by default).
*Options*: (A) Retain indefinitely (current implicit default — no purge logic exists). (B) Retain for N years per institutional/legal policy, with an archival (not deletion) path after.
*Recommended*: confirm the institution's actual policy before building any purge/archive logic; until confirmed, (A) is the safe default (never delete without a confirmed retention rule) — but this cannot stay unresolved indefinitely if storage costs or compliance obligations are real constraints.
*Status*: **OPEN**

**DEC-011 — QR/biometric attendance timeline**
*Question*: Is QR-based attendance a near-term (Phase 2 post-launch) requirement, or genuinely long-term/speculative?
*Why it matters*: Affects how much of the `attendance.method` extensibility to build now vs. purely reserve the enum value for.
*Options*: (A) QR is near-term — build the method plumbing (device scanning flow, seat-cross-check validation) alongside seat-based in Phase 17. (B) QR and biometric are both long-term — reserve the enum, build only manual + seat-based now (current IMPLEMENTATION_PLAN.md assumption).
*Recommended*: (B), matching the current plan — revisit if the institution confirms near-term QR demand.
*Status*: **OPEN**

**DEC-012 — Exam Session ↔ Quiz cardinality in practice**
*Question*: DOMAIN_MODEL.md models `exam_session_quizzes` as generically M:N (a quiz could theoretically attach to more than one session). Should a business rule restrict a quiz to at most one active session at a time?
*RESOLVED — see [ADR-006](adr/006-quiz-single-active-session.md)*: A quiz may be attached to at most one non-cancelled exam session at a time, enforced via a DB-level partial-unique mechanism (denormalized `is_active_attachment` flag + partial unique index), added to BUSINESS_RULES.md as **BR-053**. A quiz may re-attach to a new session only after its prior session is CANCELLED.
*Status*: **RESOLVED** (engineering decision — no stakeholder input required, no legitimate use case for simultaneous dual-session attachment exists in the source requirements).

---

## Risk Register (supporting the above)

| Category | Risk | Mitigation status |
|---|---|---|
| Ambiguous requirement | Resubmission cap, metadata-edit whitelist (DEC-003/004) | Documented, default chosen, needs confirmation |
| Conflicting requirement | None identified — source spec was internally consistent once the M:N junction-table pattern was applied uniformly | — |
| Missing business rule | Quiz-to-single-active-session restriction (DEC-012) | Identified, recommended fix pending BR-053 addition |
| Assumption | Single-tenant scope, admin-only enrollment | Documented in DEC-001/002 |
| Architectural risk | Seating engine correctness at scale (graph-coloring + repair may under-perform in adversarial room layouts) | Mitigated by explicit soft-constraint reporting (never silently wrong) + Phase 14 test plan |
| Scalability risk | Attendance/audit_logs/notifications table growth at 100K+ scale over multiple years | Mitigated by range partitioning strategy (ARCHITECTURE.md §AK) — retention policy (DEC-010) still needed for long-term bound |
| Security risk | Incident evidence handling (file upload path) | Addressed structurally (object storage + pre-signed URLs, virus scan) — Phase 22 must verify implementation matches design |
| Data-integrity risk | Room/seat/attendance duplication under concurrent writes | Addressed via DB-level unique/exclude constraints (BR-018/024/025/033) — not merely app-level checks |
| Concurrency risk | Conflict Engine races (double-booking, double-assignment) | Addressed via SERIALIZABLE/row-lock strategy (ARCHITECTURE.md §AH) — Phase 10 concurrency tests are the verification gate |
| Product-decision risk | Incident disclosure policy (DEC-009) | Flagged HIGH PRIORITY — has due-process/legal weight beyond engineering discretion |
