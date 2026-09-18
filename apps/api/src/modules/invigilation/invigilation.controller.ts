import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InvigilationService } from './invigilation.service';
import { CreateInvigilatorDto } from './dto/create-invigilator.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Invigilation" exactly — the only two documented endpoints for this phase. */
@Controller()
export class InvigilationController {
  constructor(private readonly invigilationService: InvigilationService) {}

  @Roles(ROLE.ADMIN)
  @Post('exam-sessions/:id/invigilators')
  assign(
    @Param('id') id: string,
    @Body() dto: CreateInvigilatorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invigilationService.assign(id, dto, actor);
  }

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
