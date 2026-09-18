/**
 * Pure domain-logic functions (ARCHITECTURE.md §AW). Seating generation +
 * validation (Phase 13, IMPLEMENTATION_PLAN.md: "this phase's engine work
 * should be built as pure, framework-independent functions in
 * packages/domain-logic") are the first real contents here — the
 * conflict-engine (Phase 10) and room-allocation (Phase 12) algorithms
 * were built directly in apps/api before this requirement was explicitly
 * stated for a specific phase; not retrofitted here, out of this phase's
 * scope. Phase 14 adds the `ANTI_CHEATING` strategy (§U) as a 6th case
 * inside `generateSeating` itself — its internals
 * (`generateAntiCheatingPlacement` et al., seating/anti-cheating.ts) are
 * not part of this public surface, same as the other five strategies'
 * own internal helpers.
 */
export * from './seating/types';
export { generateSeating } from './seating/generate-seating';
export { validateSeating } from './seating/validate-seating';
export { seededShuffle } from './seating/deterministic-random';

export * from './notifications/types';
export { renderMessage } from './notifications/render-message';
export { BACKOFF_SCHEDULE_MS, MAX_ATTEMPTS, decideRetry } from './notifications/retry-policy';
export { CRITICAL_QUEUE_NAME, STANDARD_QUEUE_NAME, queueNameForEventType } from './notifications/queue-lanes';
