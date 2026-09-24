import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AcademicStatus } from '@exam-sync/db';
import { FacultyService } from './faculty.service';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

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

  /**
   * FACULTY needs this too (faculty-lifecycle-ownership change):
   * InvigilatorPanel's "Assign Invigilator" picker calls this to populate
   * its faculty dropdown when a faculty member assigns another faculty to
   * invigilate their session — same gap and same fix as `GET /students`
   * (RosterPanel's "Add Student" picker). Exposed fields (name/department/
   * employee code/status — no email or other PII) are no more sensitive
   * than what's already shown elsewhere; `assign` independently
   * re-validates the target faculty server-side regardless of what this
   * list shows.
   */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
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

  /**
   * `GET /faculty/me` — resolves the calling FACULTY's own Faculty row.
   * Not in API_CONTRACT.md and not needed by `GET /faculty/{id}`'s own
   * self-or-ADMIN scoping (that already requires knowing your own faculty
   * id first) — added because `GET /users/me` deliberately has a fixed,
   * documented shape with no `facultyId` field, so the frontend had no way
   * to resolve "my own faculty id" at all (blocking "My Invigilation
   * Duties" and "My Assignments" — both need it to call their own
   * faculty-scoped GETs). 404s for a non-faculty actor (or a FACULTY-role
   * user with no Faculty profile row yet), same as any other
   * resource-not-found case. Registered BEFORE `:id` below so "me" isn't
   * swallowed by that param route.
   */
  @Roles(ROLE.FACULTY)
  @Get('me')
  async me(@CurrentUser() actor: AuthenticatedUser) {
    const faculty = await this.facultyService.findByUserId(actor.id);
    if (!faculty) {
      throw new NotFoundException();
    }
    return faculty;
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

  @Roles(ROLE.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.facultyService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="faculty-bulk-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Roles(ROLE.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const job = await this.facultyService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }
}
