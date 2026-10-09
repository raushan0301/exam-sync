import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Security headers (Phase 22 hardening). This is a pure JSON API with no
  // HTML views of its own, so:
  //  - `contentSecurityPolicy` is disabled — helmet's default CSP is
  //    designed for HTML-serving apps (script-src/style-src directives
  //    etc.) and has nothing meaningful to restrict here; a default CSP
  //    would just be dead weight, not a real protection, for a JSON API.
  //  - `crossOriginResourcePolicy` is set to `cross-origin` rather than
  //    helmet's default `same-origin`: this API is deliberately called
  //    cross-origin by apps/web (see the CORS config immediately below),
  //    and the default CORP value would have browsers block those
  //    legitimate cross-origin JSON responses via `no-cors`/opaque
  //    response blocking — CORS above is the actual access-control layer,
  //    CORP here must not fight it.
  // Everything else (X-Content-Type-Options: nosniff, X-Frame-Options,
  // Strict-Transport-Security, X-DNS-Prefetch-Control, etc.) stays at
  // helmet's sensible defaults.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Phase 15 — QueueModule's BullMQ/Redis connections (and the relay's
  // polling interval) need their `onModuleDestroy`/`onApplicationShutdown`
  // hooks to actually run on a process signal (container stop/restart),
  // not just on an explicit `app.close()` call — this wires that up.
  app.enableShutdownHooks();

  // CORS — Phase 2 is the first phase with a real browser client
  // (apps/web) calling this API cross-origin (different port in dev,
  // different origin in production). Restricted to an explicit allowlist,
  // never a wildcard, since requests carry a bearer token.
  app.enableCors({
    origin: (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3001').split(','),
    credentials: false, // bearer-token auth, not cookies — no credentials mode needed
    // Response headers are otherwise invisible to cross-origin JS (the CORS
    // "safelist" is tiny by default and doesn't include this one) — without
    // it, `GET /report-jobs/{id}/download`'s `Content-Disposition` header
    // reads back as null in the browser even though curl/Postman see it
    // fine, and apps/web's `downloadReportJob` silently falls back to a
    // meaningless `report-${jobId}` filename.
    exposedHeaders: ['Content-Disposition'],
  });

  // Input validation at the API boundary (ARCHITECTURE.md §AG) — every DTO
  // decorated with class-validator is enforced here, application-wide, not
  // per-controller. `whitelist` strips unknown fields; `forbidNonWhitelisted`
  // rejects a request that sent them, rather than silently dropping data the
  // caller thought was being used.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  await app.listen(port);
  logger.log(`Exam-Sync API listening on port ${port}`);
}

bootstrap();
