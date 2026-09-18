import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { Roles } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Audit" — `GET /audit-logs`, ADMIN only (BR-047). */
@Controller('audit-logs')
@Roles(ROLE.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('entity_type') entityType?: string,
    @Query('entity_id') entityId?: string,
    @Query('actor_id') actorId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    return this.auditLogsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      entityType,
      entityId,
      actorId,
      dateFrom,
      dateTo,
    });
  }
}
