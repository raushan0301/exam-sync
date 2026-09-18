import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';

/**
 * Central config module (Phase 0 — ARCHITECTURE.md §AW "common/").
 * Loads and validates environment configuration once; every other module
 * reads config through @nestjs/config's ConfigService rather than reading
 * process.env directly, keeping config access uniform ahead of Phase 1+.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
  ],
})
export class AppConfigModule {}
