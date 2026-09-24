import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — see this phase's disclosed multer-DoS mitigation note.

/** Matches API_CONTRACT.md "Students" — GET /students (list) is an extrapolation, see this phase's pre-implementation plan. */
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateStudentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.studentsService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.studentsService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="student-bulk-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Roles(ROLE.ADMIN)
  @Post('bulk-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A "file" field with an .xlsx file is required.');
    }
    const job = await this.studentsService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }

  /**
   * Not in API_CONTRACT.md's literal table (only GET /students/{id} and
   * PATCH are listed) — extrapolated the same way Phase 2 extended
   * departments' pattern to programs/batches. FACULTY needs this too
   * (faculty-lifecycle-ownership change): RosterPanel's "Add Student"
   * picker calls this to populate its student dropdown when a faculty
   * manually adds someone to their own session's roster. Exposed fields
   * (name/roll number/program/batch/status — no email or other PII) are
   * no more sensitive than what faculty already see in the roster table
   * itself, and `addRosterEntry` independently re-checks BR-005
   * eligibility server-side regardless of what this list shows.
   */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: AcademicStatus,
    @Query('program_id') programId?: string,
    @Query('batch_id') batchId?: string,
  ) {
    return this.studentsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      programId,
      batchId,
    });
  }

  /** ADMIN, FACULTY (if teaches them — Phase 5), or the student themself (BR-045). */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.studentsService.findByIdScoped(id, actor);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.studentsService.update(id, dto, actor);
  }
}
