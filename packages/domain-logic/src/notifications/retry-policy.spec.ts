import { BACKOFF_SCHEDULE_MS, MAX_ATTEMPTS, decideRetry } from './retry-policy';

describe('retry-policy', () => {
  it('has the exact ARCHITECTURE.md §AB backoff schedule (1m, 5m, 30m, 2h, 12h)', () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 60 * 60_000,
      12 * 60 * 60_000,
    ]);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('schedules a retry with the 1m backoff after the 1st failed attempt', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const decision = decideRetry(1, now);
    expect(decision).toEqual({ outcome: 'RETRYING', nextAttemptAt: new Date('2026-01-01T00:01:00Z') });
  });

  it('schedules the 5th retry with the 12h backoff after the 5th failed attempt', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const decision = decideRetry(5, now);
    expect(decision).toEqual({ outcome: 'RETRYING', nextAttemptAt: new Date('2026-01-01T12:00:00Z') });
  });

  it('moves to DEAD_LETTER once attempts exceed the 5-attempt budget (BR-044)', () => {
    expect(decideRetry(6)).toEqual({ outcome: 'DEAD_LETTER' });
    expect(decideRetry(100)).toEqual({ outcome: 'DEAD_LETTER' });
  });

  it('never silently drops — every attempt count maps to either RETRYING or DEAD_LETTER, never undefined', () => {
    for (let i = 1; i <= 10; i++) {
      const decision = decideRetry(i);
      expect(['RETRYING', 'DEAD_LETTER']).toContain(decision.outcome);
    }
  });
});
