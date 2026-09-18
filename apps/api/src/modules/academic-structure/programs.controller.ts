import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AcademicStatus } from '@exam-sync/db';
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateProgramDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.programsService.create(dto, actor);
  }

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: AcademicStatus,
    @Query('department_id') departmentId?: string,
  ) {
    return this.programsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      departmentId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.programsService.findById(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.programsService.update(id, dto, actor);
  }
}
