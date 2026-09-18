import IORedis from 'ioredis';

/**
 * The one Redis connection BullMQ's producers (relay) use in this
 * process. Redis here is purely the dispatch-queue substrate (ARCHITECTURE.md
 * §AV's tech-stack pick, "BullMQ ... Redis-backed") — never a source of
 * truth for delivery/retry state, which stays in Postgres on the
 * `notifications` row itself (ADR-005, ADR-009's caching-only Redis
 * scope). `maxRetriesPerRequest: null` is BullMQ's documented requirement
 * for any connection it manages.
 */
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}
