import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { FacultyAssignmentsService } from './faculty-assignments.service';
import { CreateFacultyAssignmentDto } from './dto/create-faculty-assignment.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { FacultyService } from '../faculty';

/**
 * Matches API_CONTRACT.md "Faculty" rows for
 * `POST /faculty-assignments`, `DELETE /faculty-assignments/{id}`, and
 * `GET /faculty/{id}/assignments` exactly — all ADMIN-only per BR-007
 * except the GET, which is "self or ADMIN" (a faculty member can see their
 * own teaching load).
 */
@Controller()
export class FacultyAssignmentsController {
  constructor(
    private readonly assignmentsService: FacultyAssignmentsService,
    private readonly facultyService: FacultyService,
  ) {}

  @Roles(ROLE.ADMIN)
  @Post('faculty-assignments')
  create(@Body() dto: CreateFacultyAssignmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentsService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Delete('faculty-assignments/:id')
  end(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignmentsService.end(id, actor);
  }

  /**
   * `GET /faculty/{id}/assignments` (self or ADMIN). Reuses Phase 4's
   * FacultyService.findByIdScoped for the exact same self-or-ADMIN,
   * 404-not-403 check already proven for `GET /faculty/{id}` — this
   * endpoint is authorized identically, just returns a different payload.
   */
  @Get('faculty/:id/assignments')
  async listForFaculty(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.facultyService.findByIdScoped(id, actor);
    return this.assignmentsService.listForFaculty(id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
