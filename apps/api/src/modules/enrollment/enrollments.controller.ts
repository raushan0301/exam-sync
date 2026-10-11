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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { BulkEnrollmentDto } from './dto/bulk-enrollment.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — same cap as every other bulk import.

/** Matches API_CONTRACT.md "Enrollment" exactly. */
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Post('enrollments')
  create(@Body() dto: CreateEnrollmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrollmentsService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post('enrollments/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  async bulkCreate(@Body() dto: BulkEnrollmentDto, @CurrentUser() actor: AuthenticatedUser) {
    const job = await this.enrollmentsService.bulkCreate(dto.enrollments, actor);
    return { job_id: job.id };
  }

  @Roles(ROLE.ADMIN)
  @Get('enrollments/bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.enrollmentsService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="enrollment-bulk-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Roles(ROLE.ADMIN)
  @Post('enrollments/bulk-import')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A "file" field with an .xlsx file is required.');
    }
    const job = await this.enrollmentsService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }

  @Roles(ROLE.ADMIN)
  @Patch('enrollments/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.enrollmentsService.update(id, dto, actor);
  }

  /** Self / ADMIN / teaching FACULTY — resource-level check inside the service (404-not-403, IDOR-safe). */
  @Get('students/:id/enrollments')
  listForStudent(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.enrollmentsService.listForStudent(id, actor);
  }
}
