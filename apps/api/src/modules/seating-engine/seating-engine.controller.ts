import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SeatingEngineService } from './seating-engine.service';
import { GenerateSeatingDto } from './dto/generate-seating.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Seating" — the Phase 13 subset:
 * `POST /exam-sessions/{id}/seating/generate`, `GET /seating-jobs/{id}`,
 * `GET /seating-plans/{id}`, `POST /seating-plans/{id}/finalize`.
 * `POST /seating-plans/{id}/swap` (manual override) is documented in
 * API_CONTRACT.md's broader Seating section but is NOT listed in
 * IMPLEMENTATION_PLAN.md Phase 13's own "APIs" line — deliberately not
 * implemented here (deferred, not an oversight).
 */
@Controller()
export class SeatingEngineController {
  constructor(private readonly seatingEngineService: SeatingEngineService) {}

  @Roles(ROLE.ADMIN)
  @Post('exam-sessions/:id/seating/generate')
  @HttpCode(202)
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateSeatingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.seatingEngineService.generate(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get('seating-jobs/:id')
  getJob(@Param('id') id: string) {
    return this.seatingEngineService.getJob(id);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('seating-plans/:id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.seatingEngineService.findByIdScoped(id, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post('seating-plans/:id/finalize')
  finalize(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.seatingEngineService.finalize(id, actor);
  }
}
