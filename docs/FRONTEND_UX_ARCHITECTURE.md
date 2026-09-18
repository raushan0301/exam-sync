# Exam-Sync — Frontend UI/UX Audit & Design Architecture

Companion to PRD.md / ARCHITECTURE.md / DOMAIN_MODEL.md / BUSINESS_RULES.md / API_CONTRACT.md / EDGE_CASES.md / docs/adr/*.md — same document-precedence rules apply. This document is the **audit and architecture only**; no frontend code is implemented yet, no backend code was touched. Produced per explicit authorization to pause Phase 21–24 and plan the frontend before implementing it.

---

## 0. Audit — current state

**Stack**: Next.js 14.2 (App Router), React 18, TypeScript. No UI library, no CSS framework (no Tailwind, no CSS-in-JS, no component kit) — every existing page uses raw inline `style={{...}}` objects. `apps/web/package.json` has exactly three runtime dependencies (`next`, `react`, `react-dom`).

**Routes that exist** (`apps/web/app/`): `/login`, `/admin/dashboard`, `/admin/academic-structure/{departments,programs,batches,subjects}` (built on one shared `CrudPage` component), `/faculty/dashboard`, `/student/dashboard`. Everything else — quizzes, approvals, exam sessions, rooms, seating, invigilation, attendance, incidents, reports, notifications, audit — **has no frontend at all**. This is a Phase-0/2 skeleton, not a partial build to extend incrementally; the frontend is being built from near-zero.

**API client** (`apps/web/lib/api-client.ts`): a minimal `apiFetch()` wrapper — bearer token from `localStorage`, throws `ApiError` on non-2xx, no retry, no refresh-rotation, no request-cancellation, no query-key caching. A 401 currently does nothing automatic (the comment says "just sends the user back to /login" but no such redirect exists in the code read). This needs a real data layer.

**Auth** (`apps/web/lib/auth-client.ts`): `login()` and `logout()` only. No `/auth/refresh` usage, no session/identity context (`GET /users/me`), no route guarding, no role-based redirect. `CrudPage.tsx` is the only "real" component and is generic (config-driven list/create/edit/deactivate).

**Design system**: none. No tokens, no primitives, no icon set, no typography scale. Every visual decision below is a fresh recommendation, not a preservation of existing choices — this audit found nothing to preserve.

**Backend surface this frontend must consume**: the full API_CONTRACT.md table (Authentication, Users/RBAC, Departments/Programs/Batches, Students, Faculty, Subjects, Enrollment, Quiz, Exam Sessions, Student Assignment, Rooms, Room Allocation, Seating, Invigilation, Attendance, Incidents, Notifications, Reports, Audit) — cursor pagination everywhere, bracket-syntax filters, idempotency keys on the documented mutating POSTs, `If-Match` optimistic-locking on quiz edits, async job patterns (`202 {job_id}` + poll) for bulk import, student assignment at scale, seating generation, and reports.

**Roles**: `ADMIN`, `FACULTY`, `STUDENT`, `INVIGILATOR` (per `apps/api/src/common/auth/auth.types.ts` — INVIGILATOR exists as a role constant; the current UI plan below folds invigilation duties into the FACULTY experience per BUSINESS_RULES.md's own treatment of invigilators as faculty members carrying an additional duty, not a separate persona with its own dashboard — this is a disclosed simplification, flag if a distinct invigilator-only login population is expected).

---

## 1. Design System

**Typography**: two-face pairing, both self-hosted or Google Fonts (`<link>` in `app/layout.tsx`, `next/font` for zero-CLS loading). A grounded, slightly condensed grotesque for UI/data (e.g. **IBM Plex Sans** or **Public Sans** — both designed for dense data UI, both free from the "Inter-everywhere" AI-dashboard tell) at weights 400/500/600; **IBM Plex Mono** for anything identifier-shaped (IDs, room/seat codes, request IDs, timestamps) so scanning a seat map or audit log doesn't force a serif/sans context switch. Scale (rem, 16px root): `12/13/14/16/18/20/24/30` — display sizes stop at 30px; this is an operations tool, not a marketing site. Line-height 1.4 body, 1.2 headings. Never below 14px for body text in a data table (13px permitted only for dense table cells and metadata rows).

**Spacing**: 4px base unit, scale `4/8/12/16/24/32/48/64`. Page gutter 24px desktop / 16px mobile. Card padding 16px (dense) or 24px (form/detail). No arbitrary values outside the scale.

**Layout/grid**: 12-column fluid grid, max content width 1440px on desktop with a persistent left sidebar (240px expanded / 64px collapsed) + top bar (56px) for Admin/Faculty; Student gets a lighter shell (top bar only, no sidebar — students have ~5 destinations, a sidebar is overhead). Detail pages use a 2-column layout (primary content + 320px right rail for metadata/audit/related actions) above 1280px, collapsing to single-column below.

**Border radius**: 6px for controls (buttons, inputs, badges), 8px for cards/modals, 4px for small chips/tags. Deliberately restrained — not the 16–24px "soft SaaS" radius that reads as consumer/AI-generated.

**Shadows**: two levels only. `--shadow-sm` (1px hairline border + barely-there `0 1px 2px rgba(0,0,0,.04)`) for cards at rest; `--shadow-md` (`0 4px 16px rgba(0,0,0,.10)`) for popovers/dropdowns/modals. No shadow on hover-state cards — use a border-color shift instead. This is an enterprise data tool; shadows communicate elevation for overlays, not decoration for flat content.

**Color**: neutral base is a cool, low-chroma gray (oklch, chroma ≤ 0.01) — not pure `#fff`/`#000`. One accent hue for primary actions/links/focus, chosen deliberately (a restrained blue or teal — avoid violet/purple, the most over-used "AI product" accent of 2024–2025). **Semantic status colors are the real design work here** (see §6/§7/§9) because this product's entire value is "know the state of things at a glance": a fixed, non-negotiable palette —
- `neutral` (draft/inactive) — gray
- `info` (in-progress, pending, processing) — blue
- `warning` (needs attention, soft-constraint violation, approaching deadline) — amber
- `success` (approved, finalized, completed, resolved) — green
- `danger` (rejected, cancelled, hard conflict, critical incident, locked-violation) — red

Every status badge, table row accent, and timeline dot in the entire product draws from exactly these five, never an ad hoc color. This is what prevents "visually noisy dashboard."

**Components** (built once in `apps/web/components/ui/`, consumed everywhere — see §15):
- **Buttons**: primary (filled, accent), secondary (outlined), tertiary/ghost (text-only), destructive (red, for reject/cancel/remove actions — always paired with a confirmation, §13). Sizes sm/md/lg. Icon-only variant requires `aria-label`. Loading state replaces label with a spinner, keeps button width fixed (no layout shift).
- **Inputs/Selects**: labeled-above (never placeholder-as-label), inline validation message below, required-field asterisk, disabled/readonly states visually distinct from each other (readonly looks like data, disabled looks unavailable). Selects support async-loaded options (e.g. subject picker scoped to faculty's own assignments) with a loading skeleton in the dropdown.
- **Tables**: sticky header, sortable columns (where the API supports it), row hover state, row click-to-open-detail where applicable, right-aligned numeric columns, monospace for IDs/codes, zebra-striping OFF by default (a border-bottom hairline is enough at this density) but available as a density toggle. Column visibility/reorder is out of scope for v1 — don't build a feature nobody asked for.
- **Modals**: for short, focused actions (confirm reject with reason, quick create). Max width 480px unless content genuinely needs more (e.g. conflict detail list). Always dismissible via Esc + backdrop click UNLESS mid-destructive-action (then require explicit Cancel).
- **Drawers** (right-side slide-over): for detail views that need context of the underlying list (e.g. click a quiz row → drawer with full quiz + approval history, list still visible behind). This is the primary pattern for Approval Queue, Incident Triage, and Audit Log detail — avoids full-page navigation for read-heavy inspection.
- **Tabs**: for splitting one entity's sub-views (e.g. Exam Session: Overview / Quizzes / Rooms / Seating / Roster / Notifications) — underline style, not pill/card tabs (pills read as "AI dashboard").
- **Badges/status indicators**: pill-shaped, 12px text, colored per the five-color semantic system above, always paired with text (never color-only — accessibility). A `<StatusBadge status={...} />` component maps every backend enum (QuizStatus, ExamSessionStatus, SeatingPlanStatus, AttendanceStatus, IncidentStatus, NotificationStatus, ReportJobStatus) to one consistent visual language.
- **Toasts**: bottom-right, auto-dismiss 5s (success) / persist-until-dismissed (error), max 3 stacked. Used for the *result* of an action already confirmed elsewhere — never the confirmation itself.
- **Alerts** (inline, non-toast): banner-style within a page for persistent contextual state — e.g. "This attendance record is locked" (§8), "3 unresolved HARD conflicts" (§6), "Disclosure capability is inert — no policy trigger configured" (system message if ADR-007's disclosure endpoint is ever exposed, which per that ADR it should NOT be in v1 — see §16 gap list).
- **Tooltips**: for icon-only affordances and truncated text only — never for content that should just be visible.
- **Loading/Empty/Error/Skeleton states**: see §13 — defined per-workflow, not generically, because "loading" means something different for a seating-generation job (202 + poll, minutes) than for a table fetch (200, milliseconds).

---

## 2. Information Architecture

### ADMIN (sidebar, grouped)
```
Dashboard
Academic Structure        Departments · Programs · Batches · Subjects
People                     Students · Faculty · Enrollments · Faculty Assignments
Quizzes                    All Quizzes · Approval Queue
Exam Sessions              List · Create · [detail: Overview/Quizzes/Rooms/Seating/Roster]
Rooms                      Room List · Availability
Invigilation                (assignment view, cross-session)
Attendance                  (cross-session monitoring view)
Incidents                   Triage Board · All Incidents
Reports                     Generate · History
Notifications                (own inbox — admins get notifications too)
Audit Log
System Health                (extends existing GET /health)
```

### FACULTY (sidebar, lighter)
```
Dashboard
My Quizzes                 List · Create
My Assignments              (read-only: subject/batch scope)
Exam Sessions                (sessions containing my quizzes — read-only detail)
My Invigilation Duties
Attendance                   (only for sessions I invigilate, only while IN_PROGRESS)
Incidents                    Report New · My Reported Incidents
Notifications
```

### STUDENT (top bar only, no sidebar)
```
Dashboard (upcoming exams)
My Schedule
Notifications
Attendance History (read-only)
```

**Role-boundary rule enforced in the UI, not just the API**: every nav item is filtered by the identity from `GET /users/me` at shell-mount time, and every page additionally re-checks role client-side before rendering (defense-in-depth mirroring the backend's own IDOR-safe `ScopedRepository` pattern, ADR-008) — a Faculty user hitting an Admin URL directly gets a 403 page, not a broken render, and the API's own resource-level 404-for-unauthorized behavior (ADR-008) is respected: the frontend never assumes "I got a 404 so it doesn't exist," it shows a neutral "not found or not accessible" state.

---

## 3–5. Role Experiences

### 3. ADMIN

- **Dashboard**: KPI tiles kept to what's *actionable*, not vanity metrics (explicitly avoiding "huge meaningless statistics" per the brief) — Pending Approvals (count, click → queue), Active Sessions Today, Open Incidents by severity, Failed/Stuck Report Jobs, DLQ/notification-failure alert if any. Below: a single combined activity feed (recent quiz submissions, session state changes, incidents) rather than five separate widgets.
- **Academic Structure**: extend the existing `CrudPage` pattern (it already works) — add the design-system components to it, keep the config-driven approach for Departments/Programs/Batches/Subjects.
- **Students/Faculty**: list + detail + bulk-import (CSV upload → `202 {job_id}` → **import job status page** with per-row success/failure table, EC-044 — this must never be a silent fire-and-forget).
- **Enrollments/Faculty Assignments**: primarily table+filter UIs; enrollment creation supports both single and bulk (`/enrollments/bulk`) with the same per-row-result pattern.
- **Quiz Approval Queue**: the single highest-frequency Admin workflow — a filterable list (status=SUBMITTED default) with a drawer-based review panel: quiz detail, faculty's completeness, one-click Approve, Reject-with-required-reason (modal, BR-003/BR-012 — submit is disabled until reason is non-empty), and the append-only approval history timeline inline. `If-Match`/version conflict (EC-047, a quiz changed between list-load and approve-click) surfaces as a non-destructive "this quiz was updated, refreshing…" reload, not a raw 409.
- **Exam Sessions**: list + a multi-tab detail (Overview/Quizzes/Rooms/Seating/Roster/Notifications) — this is the most complex admin surface, see §6/§7 for the workflow and seating UX specifically. Session creation is a short wizard: name+date/time → add quizzes (with live conflict-check panel calling `GET /exam-sessions/{id}/conflicts` as a dry-run before commit, distinguishing HARD/WARNING per BUSINESS_RULES.md's conflict classification) → done; room allocation and seating are separate steps reached from the session detail tabs, not crammed into the creation wizard.
- **Rooms**: list with capacity/building/floor filters, a seat-map editor for room setup (grid editor, mark seats accessible/inactive), availability-block management (blackout dates), and `GET /rooms/available` as a picker used inside room allocation.
- **Invigilation/Attendance (cross-session)**: an operations view for exam day — which rooms have invigilators assigned, which don't, live attendance-marking progress per room.
- **Incidents**: Kanban triage board (columns = status: OPEN → UNDER_REVIEW → RESOLVED/DISMISSED), severity-colored cards, click → detail drawer with full history and the Investigate/Escalate/Resolve/Dismiss actions gated by required-notes validation (BUSINESS_RULES.md: resolution required for RESOLVE/DISMISS).
- **Reports**: generation form (session picker + report type + format) → job status page (PENDING/RUNNING/COMPLETED/FAILED, poll or notification-driven) → history list with download links; failed jobs show the error and an explicit Retry.
- **Audit Log**: see §11 — filterable table, read-only, no create/edit/delete affordances anywhere in the UI (matches BR-049's DB-enforced immutability — the UI shouldn't even offer an action the backend will reject).
- **System Health**: a simple status page reflecting `GET /health`'s dependency block (database/redis) — internal-ops-facing, not customer-facing, minimal design investment.

### 4. FACULTY

- **Dashboard**: My quizzes by status (draft/submitted/approved/rejected counts), upcoming invigilation duties, unread notifications.
- **Quiz creation/submission**: a form scoped to the faculty's own `faculty_subject_batch_assignment` rows (subject/batch pickers pre-filtered — BR-010) — Draft autosave-on-blur (not autosave-on-keystroke, to respect the `If-Match` version model), a completeness checklist before the Submit button enables (mirrors the backend's 422 missing-fields validation so the faculty sees it before submitting, not after).
- **Exam sessions containing my quizzes**: read-only — faculty can see the session their quiz landed in, its rooms/schedule, but not edit session composition (Admin-only per API_CONTRACT.md).
- **Room selection/allocation**: per the API contract, room allocation is ADMIN-only (`POST /exam-sessions/{id}/rooms/allocate`) — the brief asks for a faculty "room selection/allocation workflow," but there is no such faculty-facing endpoint in API_CONTRACT.md. **Flagged as a genuine scope question** (§16): either this is describing faculty *viewing* their assigned room (already covered by session detail) or it names a missing backend capability. Recommend treating it as view-only in v1 and confirming with the user before inventing a write path the backend doesn't expose.
- **Invigilation duties**: `GET /faculty/{id}/invigilation-duties` — a simple upcoming-duties list with room/session/time, linking into the seating plan for that room (so an invigilator can look up "where is student X sitting" during the exam).
- **Attendance marking**: the single most time-pressured faculty workflow (marking 40+ students during a live exam) — see §8, seat-map-first UI, large touch targets, gated to `IN_PROGRESS` sessions and the invigilator-of-record only (BR-032).
- **Incident reporting**: a fast-entry form (type/severity/description, optional student/seat context pre-filled if opened from the seat map) — this needs to be reachable in ≤2 taps from the attendance/seating view during a live exam, not buried in a separate nav section.
- **Notifications**: shared inbox pattern across all roles (§ below), scoped to own notifications via `/me/notifications`.

### 5. STUDENT

- **Dashboard**: upcoming exams as cards (subject, date, time, room, seat, instructions) — this is the PRD's own literal description (ARCHITECTURE.md §AR) and should be followed closely.
- **Schedule**: full list/calendar-toggle view of all upcoming (and optionally past) exams.
- **Room/seat information + seating plan**: student-facing seating view is explicitly **filtered to their own row only** per API_CONTRACT.md (`GET /seating-plans/{id}` "student-facing view is filtered to their own row only") — never render the full room grid with other students' identities to a student caller; show only their own seat position within an anonymized room outline (so they can still find the room/row/seat physically without seeing classmates' assignment data — reuses the room outline component from §7 but with a data-masking prop, not a separate implementation).
- **Attendance status**: read-only, own history only (`/students/{id}/attendance-history`), no marking affordance ever appears for a Student session.
- **Notifications**: same shared inbox component.

---

## 6. Exam Workflow UX (state machine)

States: `DRAFT → APPROVED → ASSIGNING_STUDENTS → SEATING_GENERATION → READY_FOR_FINALIZATION → FINALIZED → NOTIFIED → IN_PROGRESS → COMPLETED` (plus `CANCELLED`, reachable from most pre-COMPLETED states per BUSINESS_RULES.md's cancellation rules).

Rendered as a **horizontal stepper** at the top of the Exam Session detail page — not a generic progress bar, an explicit labeled-step stepper where each step shows: completed (✓, muted), current (accent, bold), upcoming (gray, disabled-looking), and — critically — **skipped/not-applicable is visually distinct from not-yet-reached** (a cancelled session mid-flow shows its truncation point, not a stepper that looks "still in progress").

Per-state UI contract:

| State | Primary action available | Disabled actions (with reason on hover) | Warnings shown |
|---|---|---|---|
| DRAFT | Add/remove quizzes | Assign students (no approved quizzes yet) | none |
| APPROVED (all quizzes approved) | Run conflict check → Assign Students | Seating (no roster yet) | unapproved-quiz count if mixed |
| ASSIGNING_STUDENTS | (async — shows progress, no user action) | everything else | job status inline |
| SEATING_GENERATION | Generate seating (per room) | Finalize (until validated) | soft-constraint violations listed post-generation, never hidden (ARCHITECTURE.md §V/ADR-004) |
| READY_FOR_FINALIZATION | Finalize | — | any remaining HARD violation blocks Finalize with an explicit, named reason (never a silent disabled button — ADR-004's controlled-failure guarantee must be visible, not just enforced server-side) |
| FINALIZED | Trigger notifications (or auto per backend) | Re-generate seating (requires explicit "this will invalidate the finalized plan" confirmation) | — |
| NOTIFIED | (system state) | — | — |
| IN_PROGRESS | Mark attendance, report incidents | Edit session composition | live session banner |
| COMPLETED | View reports | all edits | attendance auto-locked banner (§8) |
| CANCELLED (any pre-COMPLETED) | — | everything | reason shown prominently, cascade-notification confirmation shown at cancel time |

Every irreversible/high-blast-radius transition (Cancel, Finalize-over-violations override if ever permitted, Re-generate-over-finalized) requires a typed or explicit confirmation modal naming the consequence, not a bare "Are you sure?" — e.g. Cancel: "This will cancel the session and notify N assigned students and M faculty. This cannot be undone. Reason (required): [___]".

---

## 7. Room + Seating UX

This is the most visually distinctive surface in the product and deserves the most design investment.

- **Room list**: card or dense-table toggle; each row/card shows capacity, building/floor, active availability-block count, and a small capacity-utilization bar for the selected date range when viewed from an allocation context.
- **Allocation workflow**: within Exam Session → Rooms tab — either manual (pick from `GET /rooms/available` results, a checklist with running total-capacity-vs-roster-size indicator) or algorithmic (`auto: true` — show the Best-Fit-Decreasing result as a proposed allocation the admin confirms, not a silent auto-commit). Capacity shortfall (EC-011) and room-time conflicts (BR-018) surface inline, before submission, via the same conflict-check pattern as session assembly.
- **Seat map** (the core new component, `<RoomSeatMap>`): an actual **physical grid rendering** — rows × columns matching the room's real `room_seats` layout, not an abstract list. Each seat is a small rectangle positioned by `rowIndex`/`colIndex`, colored by occupancy/subject (a legend maps subject → color, reusing the seating-strategy's "alternate subject" intent visually — adjacent same-subject seats are visually obvious, which is the whole point of anti-cheating seating), inactive/non-existent seats rendered as gaps (not phantom empty boxes), accessible seats marked with a small icon. Hover/click a seat → student identity + quiz + seat-swap action (admin only). This component is shared, data-masked, across: seating generation preview, finalized plan viewer, invigilator's "find my students" view, and the student's own single-seat view (§5).
- **Seating generation**: strategy picker (Sequential/Random/Alternate-Subject/Anti-Cheating, per ARCHITECTURE.md's seating engine) with a plain-language one-line description per strategy (not just an enum dropdown — admins choosing a seating strategy need to know what it does without reading a doc). Submission is async (`202 {job_id}`) — show a determinate-feeling progress state (the backend target is <2s/room, so this is usually fast, but never assume synchronous; poll `GET /seating-jobs/{id}`). Result view: the seat map + a **validation report panel** — soft-constraint score as a visible number with context ("0.94 — a few unavoidable same-subject adjacencies at row boundaries," not a bare percentage), violation list naming specific seats, and — this is the ADR-004 guarantee made visible — a HARD failure renders as a distinct, unmissable "Seating could not be completed" state with the specific unsatisfiable constraint named and suggested next steps (add room, adjust constraints), never a plan that silently looks finalized when it isn't.
- **Swap**: drag-and-drop OR click-two-seats-then-confirm (drag is nicer but must have a non-drag fallback for accessibility/touch) — always shows a before/after mini-preview in the confirmation, always audited (matches backend's own audit requirement for this action).

---

## 8. Attendance UX

- **Attendance dashboard** (per session, invigilator view): the seat map from §7, recolored by attendance status instead of subject (Present/Absent/Late/Excused/Other — five more semantic-adjacent colors layered onto the same five-color system, e.g. success=Present, warning=Late, neutral=not-yet-marked, danger=Absent-unexcused) — marking attendance IS clicking a seat, not filling a separate form, because the invigilator is physically walking a room.
- **Mark**: tap seat → quick-select status (large touch targets, §12 mobile note — this happens on a phone/tablet in a room) → optimistic UI update, background POST, rollback-with-toast on failure.
- **Update/locked**: post-session-completion, attendance auto-locks (per BUSINESS_RULES.md) — the UI reflects this as a visible "Locked" banner and disables the quick-tap interaction; a correction still possible via `PATCH /attendance/{id}` requires an explicit reason field that the UI enforces (423 Locked without a reason, per BR-035) — never let a user submit and discover the reason requirement only from the error.
- **List view alternative**: a plain table (student/status/method/timestamp) for admins reviewing after the fact, not physically in the room — same data, different rendering for a different context.
- **History**: student-facing read-only timeline.

---

## 9. Incident UX

- **Creation**: fast form, type (dropdown with the documented enum: cheating suspicion, unauthorized material, mobile phone, misconduct, late arrival, medical emergency, identity issue, seating issue, technical issue, room issue, other), severity (visual 4-level selector, not a plain dropdown — LOW/MEDIUM/HIGH/CRITICAL with color-coded chips, since severity drives triage priority and should be impossible to pick absent-mindedly), description, optional evidence-metadata reference, optional pre-filled student/seat/room context when launched from the seat map.
- **Status/history**: OPEN → UNDER_REVIEW → RESOLVED/DISMISSED, rendered as a small status timeline within the detail drawer (mirrors the approval-history pattern established for quizzes — one consistent "audit timeline" component reused across quiz approval, incident status, and attendance corrections).
- **Triage board**: Kanban by status (§3), severity-sorted within column, CRITICAL incidents visually pinned/highlighted (matches BR-038's "immediate Admin notification for CRITICAL").
- **Escalation/Resolution/Dismissal**: action buttons gated by required-notes validation, same pattern as quiz reject.
- **Disclosure**: per ADR-007/DEC-009, the disclosure capability ships inert and is an open policy question — **recommend the frontend does NOT expose a disclosure action at all in v1**, even though the backend endpoint may technically exist, until DEC-009 is resolved. This avoids the UI silently deciding a policy question the backend explicitly deferred.

---

## 10. Reporting UX

- **Generation**: a short form (report type tabs: Attendance/Seating Plan/Incident Report/Room Utilization, session picker, format CSV/Excel) — submit → immediate `202` acknowledgement toast + navigation to job status.
- **Job status**: PENDING/RUNNING shown with an indeterminate progress indicator (these are backend-generated, duration varies with session size — never fake a determinate bar); COMPLETED shows a prominent Download button; FAILED shows the error message and a Retry (re-submits the same generation request).
- **History**: table of past report jobs (type, format, session, requested-by, status, generated-at) with download links for completed ones — this doubles as the audit trail for "who exported what," which matters for an exam-data product.
- **Empty state**: "No reports generated yet" with a direct CTA into generation, not a bare empty table.

---

## 11. Audit + Observability UX

- **Audit Log table**: filters exactly matching the backend's documented filter set (`entity_type, entity_id, actor_id, date_range`) as a filter bar above a dense table — columns: timestamp, actor (name+email, not just ID), action (colored chip: CREATE=green, UPDATE=blue, DEACTIVATE/REACTIVATE=neutral), entity (type+id, clickable if a matching detail page exists), reason (if present), request ID (monospace, copy-to-clipboard icon — this is the correlation ID that ties to backend logs, valuable for support/debugging).
- **Row detail**: click a row → drawer showing the full before/after JSON diff (old_value/new_value), rendered as a readable key-value diff, not a raw JSON dump — this is genuinely useful for admins investigating "what changed and when," and redacted fields (passwordHash etc.) should render as their literal `[REDACTED]` marker, not hidden entirely (so it's clear redaction happened, not that the field never existed).
- **Search**: given cursor pagination on a table that can exceed 10K rows, there is no full-text search endpoint in API_CONTRACT.md — the UI should rely on the documented filters only; do not build a client-side search box that implies searching beyond the loaded page (a common, misleading pattern on cursor-paginated data).
- **Health status**: simple, separate page (§3) — not conflated with the audit log.

---

## 12. Responsive Design

Not "shrink the table" — real transformations per breakpoint (desktop ≥1280px, laptop 1024–1279px, tablet 768–1023px, mobile <768px):

- **Sidebar nav** (Admin/Faculty): full sidebar ≥1024px → icon-only collapsed sidebar 768–1023px (click to expand overlay) → bottom tab bar or hamburger drawer <768px (bottom tab bar preferred for Faculty's short nav during live-exam mobile use; hamburger for Admin's longer nav).
- **Tables**: ≥1024px full table. 768–1023px, drop secondary columns (keep identity + status + primary action, move the rest into a row-expand). <768px, tables become a **card list** — one card per row, label:value pairs stacked, primary action as a full-width button — never a horizontally-scrolling table on mobile (explicitly the anti-pattern the brief calls out).
- **Seat map**: this is the hard case. ≥1024px, full grid with pan/zoom for large rooms. <1024px, the grid becomes pinch-zoom-and-pan within a fixed viewport (mobile users, specifically invigilators marking attendance on a phone, need this to actually work — this is the single most important mobile interaction in the whole product, per §8, and deserves real engineering time, not an afterthought).
- **Forms/wizards**: multi-column forms (e.g. quiz creation) collapse to single-column <768px; multi-step wizards (session creation) become a linear stepper with one step visible at a time on mobile regardless of desktop's potentially-combined layout.
- **Drawers**: right-side slide-over ≥768px → full-screen modal <768px (a 320px drawer on a 375px-wide phone is unusable).
- **Dashboards**: KPI tile grid 4-across desktop → 2-across tablet → 1-across mobile, reordered by priority (most actionable tile first) not just reflowed.

---

## 13. UX Quality — per-workflow state matrix

Every workflow in §3–11 must define all of: Loading, Empty, Error, Success, Confirmation, Validation, Permission-denied, Conflict, Network-failure, Retry. Rather than repeat this per workflow, the **shared contract**:

- **Loading**: skeleton screens matching the eventual layout (not spinners) for initial page loads; inline spinners for in-place actions (button loading state); progress/poll UI for async jobs (§7/§10) — never a bare spinner for something that takes >2s with no indication of what's happening.
- **Empty**: always has a one-line explanation + a direct action where one exists ("No quizzes yet — Create your first quiz"), never a bare "No data."
- **Error**: distinguish validation errors (inline, field-level, from 422 responses — map backend field names to form fields) from system errors (toast/banner, from 500s) from not-found (dedicated page/state, from 404s, worded neutrally per the resource-level-auth note in §2).
- **Success**: toast for background/async actions, inline state change for synchronous ones (a button that becomes a checkmark, a row that updates in place) — avoid toast-spam for every trivial action.
- **Confirmation**: required for anything destructive or hard-to-reverse (reject, cancel, deactivate, delete-adjacent actions, finalize/re-generate-over-finalized) — modal naming the specific consequence, never a generic "Are you sure?"
- **Validation**: client-side mirrors backend rules where knowable (required fields, format) but the backend is always the source of truth — a client-side-valid submission can still 422/409, and that must render cleanly, not as a raw error dump.
- **Permission denied**: a dedicated 403 state (not a broken page), consistent across the app, with a "return to your dashboard" action.
- **Conflict** (409): version-mismatch (`If-Match`) reloads and informs, not a raw error; business-rule conflicts (BR-018, BR-031, etc.) render the backend's structured `details[]` array as a readable list, not JSON.
- **Network failure**: distinguished from server error — "check your connection" with a Retry, vs. a genuine 5xx which gets a "something went wrong, try again" with the same Retry affordance but different copy.
- **Retry**: every error state that's plausibly transient gets an explicit Retry button, not just "refresh the page."

---

## 14. Visual Direction

**Positioning**: an operations console for exam administration — closer in spirit to a well-built air-traffic-control or hospital-ops dashboard than a marketing SaaS product. The defining quality is that an admin during exam week can scan it fast and trust what it shows.

**Concretely**:
- Neutral, cool-gray base; one restrained accent (blue/teal, not purple/violet); the five-color semantic status system (§1) as the ONLY source of color variation beyond the accent — this alone prevents visual noise, because color always means something specific.
- Flat surfaces, hairline borders, minimal shadow (§1) — no glassmorphism, no gradient backgrounds, no decorative blur.
- 6–8px radii, not 16–24px — reads as tool, not app-store product.
- No animation beyond functional micro-transitions (200ms ease for hover/focus/drawer-slide) — no page-load reveal animations, no bouncy easing, no confetti-on-success.
- Data density is a feature, not a flaw, for Admin table/audit/seating views — but every dense view still gets real empty/loading/error states (density ≠ neglecting the edges).
- No stat-tile inflation — every number on a dashboard must be individually actionable (click → the thing it counts), or it doesn't belong there.
- Icons: single consistent stroke-based set (e.g. Lucide) at 16/20/24px, never emoji, never mixed icon styles.

---

## 15. Component Architecture

**Shared primitives** (`apps/web/components/ui/`): `Button`, `Input`, `Select`, `Checkbox`, `RadioGroup`, `Textarea`, `Badge`/`StatusBadge`, `Card`, `Modal`, `Drawer`, `Tabs`, `Toast`(+provider), `Alert`, `Tooltip`, `Skeleton`, `EmptyState`, `ErrorState`, `Table`(+`TableToCardList` responsive wrapper), `Pagination`(cursor-based), `ConfirmDialog`, `Stepper`, `Timeline` (reused for approval history / incident history / audit detail).

**Shared domain components** (`apps/web/components/domain/`): `RoomSeatMap` (the one seat-grid renderer, parameterized by coloring-mode: subject/attendance/masked-single-seat), `ConflictList` (renders backend's HARD/WARNING `details[]` consistently everywhere conflicts appear), `ApprovalHistoryTimeline`, `JobStatusPoller` (generic async-job polling hook+display, reused for import jobs/seating jobs/report jobs — one implementation of "poll until terminal state, show progress"), `RoleGate` (client-side role-check wrapper), `IdentityProvider`(context from `GET /users/me`), `ApiDataTable` (table + cursor-pagination + filter-bar wired to one query hook pattern).

**Page-level components**: one per route, composed from the above — `AdminDashboardPage`, `QuizApprovalQueuePage`, `ExamSessionDetailPage` (owns the tab/stepper composition), `RoomSeatingPage`, `AttendanceMarkingPage`, `IncidentTriageBoardPage`, `ReportGenerationPage`, `AuditLogPage`, etc. — each thin, delegating to domain components.

**Data layer** (new, replacing the bare `apiFetch`): recommend introducing a query/cache library (e.g. TanStack Query) for request de-duplication, cache invalidation on mutation, and the polling primitive `JobStatusPoller` needs — this is a genuine new dependency decision, flagged for the user's sign-off before Milestone 1 (§17), not silently added.

---

## 16. API Mapping — coverage audit

**Directly usable as-is** (the large majority): every table row in API_CONTRACT.md maps cleanly to a frontend workflow above — auth, RBAC/users, academic structure, students, faculty, subjects, enrollment, quiz lifecycle, exam session lifecycle, rooms, room allocation, seating, invigilation, attendance, incidents, notifications, reports, audit. No backend changes anticipated for the vast majority of the frontend build.

**Responses sufficient as documented**: quiz/session/incident detail payloads carry what their respective screens need (status, timestamps, actor references); async job responses (`202 {job_id}`) are a clean, consistent pattern the `JobStatusPoller` component can handle once, generically.

**Responses that may be awkward for the frontend** (flagged, not fixed — no backend changes at this stage):
- `GET /seating-plans/{id}`'s student-facing filtering ("filtered to their own row only") is described in prose, not as a distinct documented response shape — the frontend needs to confirm at implementation time whether the student-facing response is the *same* shape with other rows omitted (easy, reuse `RoomSeatMap`) or a *different*, smaller shape (needs a distinct render path). Worth a quick confirmation against the actual controller before Milestone 6.
- `GET /exam-sessions/{id}/conflicts` (dry-run) vs. the `409` a real mutating call returns on conflict — confirm both use the identical `details[]` shape so `ConflictList` truly is one component, not two similar ones.
- Report job "download URL" (`GET /report-jobs/{id}`) — confirm whether `download_url` is directly fetchable cross-origin from the browser or needs to be proxied through `apiFetch` (auth header) like every other call; Phase 19's own implementation serves the file via this app's own `GET /report-jobs/{id}/download` per its controller doc comment, so the frontend should treat it as an authenticated app route, not a public signed URL, until confirmed otherwise.

**Genuine missing/unclear frontend requirements** (product questions, not implementation gaps):
- **Faculty "room selection/allocation workflow"** (brief §4) — no such faculty-facing write endpoint exists in API_CONTRACT.md (room allocation is ADMIN-only). Needs product clarification: is this meant to be read-only visibility, or a genuinely new backend capability for faculty to request/select rooms? Recommend v1 treats it as view-only.
- **Incident disclosure UI** (brief §9) — per ADR-007/DEC-009, deliberately not recommended for v1 exposure (see §9 above) pending the open policy decision; flagged so it isn't silently built.
- **A distinct INVIGILATOR-role login experience** — the role constant exists (`ROLE.INVIGILATOR`) but this architecture folds invigilation duties into the FACULTY nav (§2/§4) since BUSINESS_RULES.md treats invigilation as a duty a faculty member carries, not a separate account type with its own dashboard. Confirm this assumption before Milestone 3 if a standalone invigilator population (e.g. non-faculty staff who only invigilate) is actually expected.
- **Full-text/global search** — not in API_CONTRACT.md anywhere; no frontend search box should imply capability the backend doesn't have (§11).

---

## 17. Implementation Roadmap

Milestones are small and independently testable, ordered design-system-first per the brief's explicit ordering constraint. Each ships with its own build/typecheck/lint/test pass — the same verification discipline used for every backend phase.

### M1 — Design System Foundation
**Objective**: establish tokens + primitive component library, no real pages yet.
**Deliverables**: `apps/web/styles/tokens.css` (or CSS-in-JS/Tailwind config, per the user's stack decision), the full `components/ui/` primitive set (§15), Storybook or a simple `/dev/components` internal preview route.
**Backend APIs used**: none.
**Dependencies**: none — can start immediately. Requires one decision from the user: styling approach (CSS Modules / Tailwind / vanilla-extract / styled-components) and whether to adopt TanStack Query now or in M2.
**Acceptance criteria**: every primitive in §1 exists, themeable via tokens, with documented props; no page-specific logic in this layer.
**Testing**: component-level unit/interaction tests (React Testing Library) for each primitive's states (loading/disabled/error where applicable); visual review against §1/§14.

### M2 — Auth, Shell, Navigation, Data Layer
**Objective**: real login → identity → role-scoped shell, replacing the current bare login page.
**Deliverables**: `IdentityProvider`, `RoleGate`, sidebar/topbar shell per role (§2), refresh-token handling, 401 → redirect-to-login, the chosen data-fetching layer wired to `apiFetch`.
**Backend APIs used**: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /users/me`.
**Dependencies**: M1.
**Acceptance criteria**: all three roles land on their correct dashboard shell post-login; direct-navigation to an out-of-role URL shows 403, not a crash; token refresh happens transparently on 401 without losing in-flight user work where feasible.
**Testing**: integration tests for login/logout/refresh flows and role-gated routing; unit tests for the API client's error mapping.

### M3 — Role Dashboards
**Objective**: real (non-placeholder) Admin/Faculty/Student dashboards.
**Deliverables**: dashboard pages per §3–5, KPI tiles wired to real counts, activity feed.
**Backend APIs used**: aggregation across quiz/session/incident/notification list endpoints (no dedicated dashboard-aggregate endpoint exists — confirm whether the frontend composes several calls or a new lightweight aggregate endpoint is worth requesting; flagged, not decided here).
**Dependencies**: M2.
**Acceptance criteria**: each dashboard tile is clickable and navigates correctly; empty states render correctly for a fresh account with no data.
**Testing**: per-role rendering tests; empty-state snapshot tests.

### M4 — Academic Structure & People (Admin)
**Objective**: rebuild the existing CrudPage screens on the new design system; add Students/Faculty/Enrollments/Faculty-Assignments (net-new).
**Deliverables**: Departments/Programs/Batches/Subjects (restyled), Students, Faculty, Enrollments, Faculty Assignments — list/create/edit/deactivate, bulk-import UI + job-status page for Students/Enrollments.
**Backend APIs used**: full Departments/Programs/Batches/Students/Faculty/Subjects/Enrollment sections of API_CONTRACT.md.
**Dependencies**: M2 (M1's primitives, M2's shell/data layer).
**Acceptance criteria**: full CRUD works end-to-end against the real backend for every entity; bulk import shows per-row results (EC-044); 409-duplicate errors map to field-level validation messages.
**Testing**: e2e (Playwright/Cypress) covering create→list→edit→deactivate per entity; bulk-import happy path + partial-failure path.

### M5 — Quiz Lifecycle & Approval
**Objective**: Faculty quiz create/submit; Admin approval queue.
**Deliverables**: quiz form (Faculty), Approval Queue (Admin) with drawer review + approval-history timeline.
**Backend APIs used**: full Quiz section.
**Dependencies**: M4 (subject/batch pickers), M3.
**Acceptance criteria**: full DRAFT→SUBMITTED→APPROVED/REJECTED flow works; version-conflict (EC-047) handled gracefully; reject requires reason; resubmission after rejection works.
**Testing**: e2e for the full lifecycle across both roles; conflict-injection test (concurrent edit) if feasible.

### M6 — Exam Sessions Core (composition, conflicts)
**Objective**: session creation, quiz attach/detach with live conflict checking, reschedule, cancel.
**Deliverables**: session list, creation wizard, Overview/Quizzes tabs, `ConflictList` component, state-machine stepper (§6, states through APPROVED).
**Backend APIs used**: Exam Sessions section (create, patch quizzes, reschedule, cancel, conflicts dry-run).
**Dependencies**: M5.
**Acceptance criteria**: HARD conflicts block, WARNINGs allow-with-acknowledgement, dry-run check matches real submission's conflict response shape (confirms §16's flagged item).
**Testing**: e2e for conflict scenarios (overlapping student, overlapping room, overlapping faculty) using seeded fixture data.

### M7 — Student Assignment, Rooms, Room Allocation
**Objective**: roster generation/management, room CRUD + seat-map editor, allocation workflow.
**Deliverables**: Roster tab (session detail), Rooms admin pages incl. seat-map editor, allocation UI (manual + auto-proposal).
**Backend APIs used**: Student Assignment, Rooms, Room Allocation sections.
**Dependencies**: M6.
**Acceptance criteria**: async assignment job shows progress and per-row/summary result; seat-map editor produces a correct `room_seats` layout; allocation surfaces capacity shortfall and room-conflict errors inline.
**Testing**: e2e for roster generation at small scale; seat-map editor unit tests for grid math.

### M8 — Seating Engine & Anti-Cheating (highest design investment)
**Objective**: the `RoomSeatMap` component, generation workflow, validation report, finalize, swap.
**Deliverables**: full §7 — strategy picker, async generation + poll, seat map render (subject-colored), validation report panel, finalize gate, manual swap.
**Backend APIs used**: Seating section in full.
**Dependencies**: M7 (`RoomSeatMap` foundation from room seat-map editor).
**Acceptance criteria**: a deliberately-infeasible fixture renders the HARD-failure state correctly (never a silently-finalized invalid plan — matches ADR-004's own backend test guarantee, verified end-to-end through the UI); soft-constraint violations are visible and specific; swap is audited and reflected immediately.
**Testing**: e2e including one infeasible-seating fixture; visual regression test for the seat map component given known layouts.

### M9 — Invigilation & Attendance
**Objective**: duty assignment/viewing, live attendance marking against the seat map.
**Deliverables**: invigilator assignment UI, Faculty's "my duties" view, `RoomSeatMap` attendance-coloring mode, mobile-optimized marking flow (§12).
**Backend APIs used**: Invigilation, Attendance sections.
**Dependencies**: M8 (`RoomSeatMap` reuse).
**Acceptance criteria**: attendance marking works correctly on a real mobile viewport (not just resized desktop); locked-state correction requires and validates a reason (BR-035); only the invigilator-of-record can mark (BR-032, enforced client-side as UX guidance, backend as the real gate).
**Testing**: e2e including a mobile-viewport run; lock-state test.

### M10 — Incidents
**Objective**: reporting + triage.
**Deliverables**: incident creation form (incl. seat-map-launched context prefill), triage Kanban board, detail drawer + status timeline.
**Backend APIs used**: Incidents section.
**Dependencies**: M8 (seat-map launch context), M3.
**Acceptance criteria**: CRITICAL severity visually distinct end-to-end; resolve/dismiss require notes; status transitions match backend's allowed-action set exactly (no UI offering a transition the backend will reject).
**Testing**: e2e for the full OPEN→...→RESOLVED path and a DISMISS path.

### M11 — Reporting, Notifications, Audit
**Objective**: the three remaining cross-cutting admin surfaces.
**Deliverables**: report generation + job status + history, shared notification inbox (all roles), Audit Log table + detail drawer, System Health page.
**Backend APIs used**: Reports, Notifications, Audit sections, `GET /health`.
**Dependencies**: M3 (notification inbox reused from dashboards), `JobStatusPoller` from M7/M8.
**Acceptance criteria**: report download works end-to-end (resolves §16's flagged download-URL question); audit filters match backend params exactly; redacted fields render their `[REDACTED]` marker correctly, not hidden or erroring.
**Testing**: e2e for report generation→download; audit filter combinations.

### M12 — Responsive, Accessibility, Polish
**Objective**: the cross-cutting pass explicitly ordered last per the brief.
**Deliverables**: verified responsive transformations (§12) across every milestone's screens at all four breakpoints, keyboard navigation + focus management audit, color-contrast audit (WCAG AA minimum given the semantic-color-heavy design), screen-reader labeling pass on icon-only controls and status badges, loading/empty/error state completeness audit against §13's matrix for every workflow.
**Backend APIs used**: none new.
**Dependencies**: all prior milestones.
**Acceptance criteria**: every page usable at 375px width without horizontal scroll or unusable tap targets; automated accessibility scan (axe) clean on every route; every workflow in §13's matrix has all ten states implemented and verified.
**Testing**: automated a11y scan in CI; manual mobile-device pass (not just browser devtools resize) for M8/M9's seat-map and attendance flows specifically, since those are the highest-risk mobile interactions.

---

## Summary for sign-off

1. **Current state**: near-empty Next.js skeleton — no design system, no data layer, ~10% of required screens exist.
2. **Recommended stack additions**: a styling approach (Tailwind recommended for velocity + the token-driven system in §1) and TanStack Query for the async-job-heavy data layer — both flagged as decisions needing your sign-off before M1/M2, not assumed.
3. **Three flagged product questions** (§16): faculty room-selection scope, incident-disclosure UI exposure, whether INVIGILATOR needs its own persona — recommend resolving before M4/M8/M9 respectively, not blocking M1–M3.
4. **12 milestones**, design-system → shell/auth → dashboards → core CRUD → quiz/session/conflict core → seating (highest investment) → invigilation/attendance → incidents → reporting/notifications/audit → responsive/a11y polish, each independently testable against the real backend already built in Phases 0–20.

No frontend code has been written. No backend code was modified. Awaiting explicit authorization to begin Milestone 1.
