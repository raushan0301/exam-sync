import { Injectable } from '@nestjs/common';

interface AttemptRecord {
  count: number;
  lockedUntil: number | null;
}

/**
 * Per-account (email-keyed) brute-force lockout, complementing
 * @nestjs/throttler's per-IP rate limiting on the login route
 * (ARCHITECTURE.md §AG: "Rate limiting on auth ... token bucket, per-user
 * and per-IP" — throttler gives per-IP, this gives the per-user half).
 *
 * KNOWN LIMITATION (disclosed, not silent): this is an in-memory Map, so it
 * resets on process restart and does not share state across multiple app
 * instances. That's an acceptable Phase 1 trade-off — AGENT_DEVELOPMENT_RULES.md
 * rule 13 says don't introduce a new dependency (Redis) without
 * justification, and Redis isn't wired into the app runtime anywhere yet
 * (docs/adr/009-caching-strategy.md scopes Redis to cache/rate-limit use,
 * which this genuinely is — but wiring the client is deferred until a
 * module actually needs it, to avoid adding an unused runtime dependency in
 * Phase 1). Revisit when the app runs as more than one instance.
 */
@Injectable()
export class LoginAttemptTrackerService {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly maxAttempts = 5;
  private readonly lockoutMs = 15 * 60 * 1000; // 15 minutes

  isLocked(email: string): boolean {
    const record = this.attempts.get(email.toLowerCase());
    if (!record || !record.lockedUntil) return false;
    if (Date.now() >= record.lockedUntil) {
      this.attempts.delete(email.toLowerCase());
      return false;
    }
    return true;
  }

  recordFailure(email: string): void {
    const key = email.toLowerCase();
    const record = this.attempts.get(key) ?? { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= this.maxAttempts) {
      record.lockedUntil = Date.now() + this.lockoutMs;
    }
    this.attempts.set(key, record);
  }

  recordSuccess(email: string): void {
    this.attempts.delete(email.toLowerCase());
  }
}
