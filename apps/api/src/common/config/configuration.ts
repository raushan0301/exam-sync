/**
 * Typed configuration shape, read from environment variables.
 * No secret values live in this repository (Phase 0 security check) — see
 * .env.example for the documented shape and local-dev-only placeholders.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string | undefined;
  };
  redis: {
    url: string | undefined;
  };
  jwt: {
    accessSecret: string | undefined;
    refreshSecret: string | undefined;
  };
  security: {
    /**
     * Safe-by-default: undefined/anything other than the literal string
     * "true" leaves rate limiting ON. Only the e2e test harness
     * (test/env-e2e.ts) sets this, and only because e2e tests share one
     * source IP across many login attempts within a single suite run,
     * which would otherwise trip the real per-IP limiter irrespective of
     * which test is running. A dedicated test (rate-limit.e2e-spec.ts)
     * explicitly re-enables it to prove the limiter itself works.
     */
    disableRateLimitForTests: boolean;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
  security: {
    disableRateLimitForTests: process.env.DISABLE_RATE_LIMIT_FOR_TESTS === 'true',
  },
});
