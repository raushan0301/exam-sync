import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FacultyAssignmentsService } from './faculty-assignments.service';
import { CreateFacultyAssignmentDto } from './dto/create-faculty-assignment.dto';
import { BulkFacultyAssignmentDto } from './dto/bulk-faculty-assignment.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { FacultyService } from '../faculty';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — same cap as every other bulk import.

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
  @Post('faculty-assignments/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  async bulkCreate(@Body() dto: BulkFacultyAssignmentDto, @CurrentUser() actor: AuthenticatedUser) {
    const job = await this.assignmentsService.bulkCreate(dto.assignments, actor);
    return { job_id: job.id };
  }

  @Roles(ROLE.ADMIN)
  @Get('faculty-assignments/bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.assignmentsService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="faculty-assignment-bulk-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Roles(ROLE.ADMIN)
  @Post('faculty-assignments/bulk-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A "file" field with an .xlsx file is required.');
    }
    const job = await this.assignmentsService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
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
