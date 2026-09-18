import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@exam-sync/db';

/**
 * Shared Prisma connection, wired into Nest's lifecycle (Phase 0's "DB
 * connection" backend-work item, made real here in Phase 1 since this is
 * the first module with actual tables to connect to).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
