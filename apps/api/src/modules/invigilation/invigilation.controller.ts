import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { InvigilationService } from './invigilation.service';
import { CreateInvigilatorDto } from './dto/create-invigilator.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Invigilation"'s two documented endpoints
 * (`assign`, `listDuties`), plus two undocumented additions:
 * `listForSession` and `remove` — see their own service-method comments
 * for why.
 */
@Controller()
export class InvigilationController {
  constructor(private readonly invigilationService: InvigilationService) {}

  /** FACULTY only, ownership-gated inside the service. */
  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/invigilators')
  assign(
    @Param('id') id: string,
    @Body() dto: CreateInvigilatorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invigilationService.assign(id, dto, actor);
  }

  /** FACULTY only, ownership-gated inside the service — removes a wrong/outdated assignment so it can be re-assigned correctly. */
  @Roles(ROLE.FACULTY)
  @Delete('exam-sessions/:id/invigilators/:invigilatorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Param('invigilatorId') invigilatorId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invigilationService.remove(id, invigilatorId, actor);
  }

  /** ADMIN (unscoped) or the owning/co-instructing FACULTY (scoped, 404 otherwise), inside the service. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('exam-sessions/:id/invigilators')
  listForSession(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.invigilationService.listForSession(id, actor, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** ADMIN (unscoped) or the owning FACULTY (scoped, 404 otherwise), inside the service. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('faculty/:id/invigilation-duties')
  listDuties(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.invigilationService.listDuties(id, actor, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
