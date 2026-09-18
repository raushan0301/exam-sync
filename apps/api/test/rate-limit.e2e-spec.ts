// Re-enable real rate limiting for this file only (env-e2e.ts's setupFiles
// disable it by default for every other e2e spec — see that file). This
// line runs at module-evaluation time, before beforeAll/Nest bootstrap,
// which is early enough for ConfigService to pick it up.
process.env.DISABLE_RATE_LIMIT_FOR_TESTS = 'false';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Login rate limiting / brute-force protection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = 'e2e-ratelimit@test.local';
  const password = 'CorrectHorseBatteryStaple1!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.upsert({ where: { email }, create: { email, passwordHash, isActive: true }, update: { passwordHash, isActive: true } });
  });

  afterAll(async () => {
    await prisma.authAuditEvent.deleteMany({ where: { email } });
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    await app.close();
  });

  it('returns 429 after exceeding the per-IP login rate limit (ARCHITECTURE.md §AG)', async () => {
    const server = app.getHttpServer();

    // The @Throttle() override on POST /auth/login allows 5 requests/60s.
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: 'wrong-on-purpose' });
      expect(res.status).toBe(401); // still under the limit, just wrong password
    }

    const sixth = await request(server)
      .post('/auth/login')
      .send({ email, password: 'wrong-on-purpose' });

    expect(sixth.status).toBe(429);
  });
});
