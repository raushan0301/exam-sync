import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportJob, Prisma } from '@exam-sync/db';
import { PrismaService } from '../prisma/prisma.service';
import { CreateImportJobInput } from './import-jobs.types';

/**
 * Generic, resource-agnostic bulk-import job tracking
 * (IMPLEMENTATION_PLAN.md Phase 3: "async job scaffold — actual queue
 * wiring can be minimal/synchronous here, upgraded in Phase 15"). Lives in
 * common/ (like Prisma/Audit) rather than inside `students` specifically,
 * because `resourceType` makes it reusable by every future bulk-import
 * feature (faculty, enrollment, ...) without duplicating this table/service.
 */
@Injectable()
export class ImportJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateImportJobInput): Promise<ImportJob> {
    return this.prisma.importJob.create({
      data: {
        resourceType: input.resourceType,
        status: input.failureCount > 0 && input.successCount === 0 ? 'FAILED' : 'COMPLETED',
        totalRows: input.totalRows,
        successCount: input.successCount,
        failureCount: input.failureCount,
        results: input.results as unknown as Prisma.InputJsonValue,
        createdByUserId: input.createdByUserId,
      },
    });
  }

  async findById(id: string): Promise<ImportJob> {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException();
    }
    return job;
  }
}
