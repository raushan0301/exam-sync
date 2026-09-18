import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { Br053ConsistencyCheckService } from './br053-consistency-check.service';

/**
 * AuditModule — Phase 20 (ARCHITECTURE.md §AJ, API_CONTRACT.md "Audit").
 *
 * Owns `GET /audit-logs` (BR-047: ADMIN only) and the BR-053 consistency-
 * check tripwire job (ARCHITECTURE_REVIEW.md §7). Does NOT own
 * `AuditHookService` — that remains in `common/audit/` (Global, injected
 * by every write-path service since Phase 2) since it is cross-cutting
 * infrastructure, not a domain concern of this module; this module is
 * only the read-side API surface plus the one background job Phase 20
 * adds, per IMPLEMENTATION_PLAN.md's Phase 20 scope.
 */
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService, Br053ConsistencyCheckService],
})
export class AuditModule {}
