import { Injectable } from '@nestjs/common';
import { AuditLog } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';

export interface ListAuditLogsParams {
  cursor?: string;
  limit?: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * `GET /audit-logs` (API_CONTRACT.md "Audit" — ADMIN only, filters
 * `entity_type, entity_id, actor_id, date_range`, paginated, read-only).
 * BR-047 (Admin-only access) is enforced at the controller via
 * `@Roles(ROLE.ADMIN)`, not here — this service has no authorization
 * logic of its own (there is no per-row scoping question for audit logs
 * the way there is for e.g. a student's own attendance; an Admin who can
 * reach this endpoint at all can see every row, so `ScopedRepository`'s
 * resource-level IDOR pattern does not apply here).
 *
 * Cursor-paginated per API_CONTRACT.md's mandatory-pagination rule for
 * any table that can exceed ~10K rows — `audit_logs` is explicitly named
 * as one such table.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListAuditLogsParams): Promise<PaginatedResult<AuditLog>> {
    const limit = resolveLimit(params.limit);

    const where: Record<string, unknown> = {};
    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.actorId) where.actorId = params.actorId;
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });

    return toPaginatedResult(rows, limit);
  }
}
