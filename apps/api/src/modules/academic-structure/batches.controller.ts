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
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

@Controller('batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateBatchDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.batchesService.create(dto, actor);
  }

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: AcademicStatus,
    @Query('program_id') programId?: string,
    @Query('year') year?: string,
  ) {
    return this.batchesService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      programId,
      year,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.batchesService.findById(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBatchDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.batchesService.update(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.batchesService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="batch-bulk-import-template.xlsx"',
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
    const job = await this.batchesService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }
}
