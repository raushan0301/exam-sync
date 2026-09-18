import { Controller, Get, Param } from '@nestjs/common';
import { ImportJobsService } from './import-jobs.service';
import { Roles } from '../auth/roles.decorator';
import { ROLE } from '../auth/auth.types';

/**
 * `GET /import-jobs/{id}` (API_CONTRACT.md, referenced from Students'
 * bulk-import row) — generic across every resource type, ADMIN-only since
 * every bulk-import trigger is itself ADMIN-only.
 */
@Controller('import-jobs')
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @Roles(ROLE.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.importJobsService.findById(id);
  }
}
