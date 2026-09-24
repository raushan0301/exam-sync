import {
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
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors students.controller.ts's bulk-import limit.

/** Matches API_CONTRACT.md "Departments / Programs / Batches" exactly. */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.departmentsService.create(dto, actor);
  }

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: AcademicStatus,
  ) {
    return this.departmentsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.departmentsService.findById(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.departmentsService.update(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.departmentsService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="department-bulk-import-template.xlsx"',
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
    const job = await this.departmentsService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }
}
