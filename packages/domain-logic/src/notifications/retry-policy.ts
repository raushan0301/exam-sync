import { RetryDecision } from './types';

/**
 * Exact retry policy from ARCHITECTURE.md §AB ("Retry policy: exponential
 * backoff (1m, 5m, 30m, 2h, 12h), 5 attempts, then dead-letter with alert
 * to Admin ops channel") — non-discretionary, reproduced verbatim here as
 * the single source of truth so the worker never hand-rolls a different
 * schedule.
 */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [
  1 * 60 * 1000, // 1m
  5 * 60 * 1000, // 5m
  30 * 60 * 1000, // 30m
  2 * 60 * 60 * 1000, // 2h
  12 * 60 * 60 * 1000, // 12h
];

export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

/**
 * Given the attempt count AFTER a failed delivery attempt (i.e. already
 * incremented), decide whether the notification is retryable (and when
 * next) or has exhausted its budget and must move to DEAD_LETTER
 * (BR-044 — "never silently dropped without a record").
 *
 * `attemptCountAfterFailure` is 1-indexed (the count following the attempt
 * that just failed) so that `attemptCountAfterFailure - 1` indexes directly
 * into `BACKOFF_SCHEDULE_MS`.
 */
export function decideRetry(attemptCountAfterFailure: number, now: Date = new Date()): RetryDecision {
  if (attemptCountAfterFailure > MAX_ATTEMPTS) {
    return { outcome: 'DEAD_LETTER' };
  }
  const delayMs = BACKOFF_SCHEDULE_MS[attemptCountAfterFailure - 1];
  return { outcome: 'RETRYING', nextAttemptAt: new Date(now.getTime() + delayMs) };
}
