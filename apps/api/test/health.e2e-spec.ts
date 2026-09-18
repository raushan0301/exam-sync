import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's bootstrap() helmet() wiring (Phase 22 security
    // headers hardening) — see this suite's own assertions below.
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with status ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res: request.Response) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('exam-sync-api');
      });
  });

  it('sets baseline security headers (helmet) on every response', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res: request.Response) => {
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['strict-transport-security']).toBeDefined();
        // Cross-origin resource policy must stay permissive — apps/web
        // calls this API cross-origin (see main.ts's CORS config), and
        // helmet's `same-origin` default would have browsers block those
        // legitimate responses.
        expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      });
  });
});
