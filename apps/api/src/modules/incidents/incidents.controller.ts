import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IncidentSeverity, IncidentStatus } from '@exam-sync/db';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Incidents" — the 4 documented routes, plus the ADR-007 `disclose` action (see `IncidentsService`'s header comment). */
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Roles(ROLE.FACULTY)
  @Post()
  create(@Body() dto: CreateIncidentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.incidentsService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateIncidentStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.incidentsService.updateStatus(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: IncidentStatus,
    @Query('severity') severity?: IncidentSeverity,
    @Query('exam_session_id') examSessionId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.incidentsService.list(actor, {
      status,
      severity,
      examSessionId,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(ROLE.ADMIN)
  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.incidentsService.getHistory(id);
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/disclose')
  disclose(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.incidentsService.disclose(id, actor);
  }
}
