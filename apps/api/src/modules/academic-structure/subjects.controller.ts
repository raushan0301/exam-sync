import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Subjects": `POST/GET/PATCH /subjects`. */
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateSubjectDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.subjectsService.create(dto, actor);
  }

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('department_id') departmentId?: string,
    @Query('program_id') programId?: string,
  ) {
    return this.subjectsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      departmentId,
      programId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subjectsService.findById(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.subjectsService.update(id, dto, actor);
  }
}
