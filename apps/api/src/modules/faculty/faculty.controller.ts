import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AcademicStatus } from '@exam-sync/db';
import { FacultyService } from './faculty.service';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Faculty"'s `POST /faculty` exactly.
 * `GET /faculty` (list) and `GET /faculty/{id}` are extrapolated the same
 * disclosed way Phase 3 did for students (see this phase's
 * pre-implementation plan). `GET /faculty/{id}/assignments` and
 * `POST|DELETE /faculty-assignments` are explicitly Phase 5 scope
 * (faculty_subject_batch_assignment doesn't exist yet) and are NOT here.
 */
@Controller('faculty')
export class FacultyController {
  constructor(private readonly facultyService: FacultyService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateFacultyDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.facultyService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: AcademicStatus,
    @Query('department_id') departmentId?: string,
  ) {
    return this.facultyService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      departmentId,
    });
  }

  /** Self or ADMIN — mirrors GET /students/{id}'s resource-level pattern. */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.facultyService.findByIdScoped(id, actor);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFacultyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.facultyService.update(id, dto, actor);
  }
}
