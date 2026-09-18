/**
 * export-worker — Phase 0 skeleton (ARCHITECTURE.md §AW, IMPLEMENTATION_PLAN.md
 * Phase 0 "Background jobs: worker process skeleton (no jobs yet)").
 *
 * This process intentionally does no work yet. It exists to establish the
 * worker as its own deployable unit (ADR-001's one deliberate exception to
 * "everything ships in the monolith") from Phase 0 onward, so later phases
 * (15 for notification-worker, 13/14 for seating-worker, 19 for
 * export-worker) add real queue-consumer logic here rather than inventing
 * the process boundary retroactively.
 */
function main(): void {
  // eslint-disable-next-line no-console
  console.log('[export-worker] skeleton started — no jobs registered yet (Phase 0).');
}

main();
