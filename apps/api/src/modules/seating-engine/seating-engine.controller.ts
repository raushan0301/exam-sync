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

  /** FACULTY only, ownership-gated inside the service. */
  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/seating/generate')
  @HttpCode(202)
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateSeatingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.seatingEngineService.generate(id, dto, actor);
  }

  /** FACULTY only, ownership-gated inside the service. Lets the owning faculty pick a different strategy for a room before finalizing — blocked once that room's plan is already FINALIZED. */
  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/seating/regenerate')
  @HttpCode(202)
  regenerate(
    @Param('id') id: string,
    @Body() dto: GenerateSeatingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.seatingEngineService.regenerate(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('seating-jobs/:id')
  getJob(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.seatingEngineService.getJob(id, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('seating-plans/:id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.seatingEngineService.findByIdScoped(id, actor);
  }

  /** FACULTY only, ownership resolved from the plan's own exam session, then gated inside the service. */
  @Roles(ROLE.FACULTY)
  @Post('seating-plans/:id/finalize')
  finalize(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.seatingEngineService.finalize(id, actor);
  }
}
