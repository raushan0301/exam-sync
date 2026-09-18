import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AcademicStatus } from '@exam-sync/db';
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

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
      year: year ? parseInt(year, 10) : undefined,
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
}
