import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health module — Phase 0's only real API surface.
 * IMPLEMENTATION_PLAN.md Phase 0 acceptance criteria: `GET /health` returns 200.
 *
 * Deliberately a plain liveness check with no DB dependency: Phase 0's own
 * scope note says "no domain tables yet", and making CI's health-check test
 * depend on a live Postgres instance would be scope creep beyond Phase 0's
 * stated acceptance criteria. A DB-readiness check can be added once Phase 1+
 * gives the app something real to check connectivity against.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
