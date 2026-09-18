import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AcademicStatus } from '@exam-sync/db';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

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
}
