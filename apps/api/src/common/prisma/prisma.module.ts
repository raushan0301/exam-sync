import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so every module can inject PrismaService without re-importing it —
 * consistent with the "common/" module being the one place cross-cutting
 * infrastructure lives (ARCHITECTURE.md §AW).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
