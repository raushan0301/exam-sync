/**
 * Sets test-only environment variables BEFORE Jest loads any application
 * module, so @nestjs/config's dotenv loader (which never overrides an
 * already-set process.env value) picks these up instead of .env's dev
 * values. This points e2e tests at a dedicated `exam_sync_test` database —
 * never the dev database seeded by packages/db/prisma/seed.ts — so tests
 * can freely create/mutate users and refresh tokens without disturbing
 * local dev state.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://exam_sync:exam_sync@localhost:5432/exam_sync_test?schema=public';
// Phase 15 — QueueModule (global, imported by AppModule) needs a real
// Redis to construct its BullMQ Queue instances even for e2e specs that
// never touch a notification, since the whole AppModule always boots.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';
// Disabled by default for every e2e spec EXCEPT rate-limit.e2e-spec.ts,
// which explicitly re-enables it (sets this back to 'false') before
// importing AppModule — see that file for why. All e2e requests in this
// suite share one source IP, which would otherwise trip the real per-IP
// login limiter irrespective of which test happens to run first.
process.env.DISABLE_RATE_LIMIT_FOR_TESTS = 'true';
