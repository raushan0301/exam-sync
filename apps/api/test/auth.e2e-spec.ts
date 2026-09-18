import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = 'e2e-admin@test.local';
  const facultyEmail = 'e2e-faculty@test.local';
  const disabledEmail = 'e2e-disabled@test.local';
  const password = 'CorrectHorseBatteryStaple1!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean slate for the identities this suite owns.
    await prisma.authAuditEvent.deleteMany({
      where: { email: { in: [adminEmail, facultyEmail, disabledEmail] } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [adminEmail, facultyEmail, disabledEmail] } } },
    });
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: [adminEmail, facultyEmail, disabledEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, facultyEmail, disabledEmail] } },
    }).catch(() => undefined);

    for (const name of ['ADMIN', 'FACULTY', 'STUDENT', 'INVIGILATOR']) {
      await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const facultyRole = await prisma.role.findUniqueOrThrow({ where: { name: 'FACULTY' } });

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, isActive: true },
      update: {},
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } }, create: { userId: admin.id, roleId: adminRole.id }, update: {} });

    const faculty = await prisma.user.upsert({
      where: { email: facultyEmail },
      create: { email: facultyEmail, passwordHash, isActive: true },
      update: {},
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: faculty.id, roleId: facultyRole.id } }, create: { userId: faculty.id, roleId: facultyRole.id }, update: {} });

    await prisma.user.upsert({
      where: { email: disabledEmail },
      create: { email: disabledEmail, passwordHash, isActive: false },
      update: {},
    });
  });

  afterAll(async () => {
    await prisma.authAuditEvent.deleteMany({
      where: { email: { in: [adminEmail, facultyEmail, disabledEmail] } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [adminEmail, facultyEmail, disabledEmail] } } },
    });
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: [adminEmail, facultyEmail, disabledEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, facultyEmail, disabledEmail] } },
    }).catch(() => undefined);
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('succeeds with correct credentials and returns a token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      expect(res.body.access_token).toEqual(expect.any(String));
      expect(res.body.refresh_token).toEqual(expect.any(String));
      expect(res.body.expires_in).toBe(15 * 60);
    });

    it('never returns the password hash in the response body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/passwordHash/i);
      expect(body).not.toContain(password);
    });

    it('rejects an unknown email with a generic error (no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@test.local', password })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password.');
    });

    it('rejects a wrong password with the SAME generic error as unknown email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: 'wrong-password' })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password.');
    });

    it('rejects a disabled account with the same generic error', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: disabledEmail, password })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password.');
    });

    it('rejects malformed input (invalid email shape) with 400/422', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password })
        .expect(400);
    });

    it('records auth audit events server-side without leaking them to the client', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: 'wrong-password' })
        .expect(401);

      const events = await prisma.authAuditEvent.findMany({
        where: { email: adminEmail, eventType: 'LOGIN_FAILURE_BAD_PASSWORD' },
      });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('GET /users/me', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('returns the authenticated identity, never the password hash', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      expect(res.body.email).toBe(adminEmail);
      expect(res.body.roles).toContain('ADMIN');
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects a malformed/garbage bearer token', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });

  describe('RBAC on GET /users (ADMIN only)', () => {
    it('allows an ADMIN', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);
    });

    it('rejects a FACULTY user with 403 (not 401 — they ARE authenticated, just not authorized)', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: facultyEmail, password })
        .expect(200);

      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(403);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and the old one can no longer be used', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      const originalRefreshToken = login.body.refresh_token;

      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: originalRefreshToken })
        .expect(200);

      expect(refreshed.body.refresh_token).not.toBe(originalRefreshToken);

      // Reusing the now-consumed original token must fail AND (theft
      // detection) revoke the whole chain, including the token just issued.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: originalRefreshToken })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshed.body.refresh_token })
        .expect(401);
    });

    it('rejects a garbage refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'not-a-real-token' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session so its refresh token can no longer be used', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: facultyEmail, password })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(401);
    });

    it('requires authentication to call logout', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(401);
    });
  });

  describe('POST /users/:id/roles (ADMIN only)', () => {
    it('lets an ADMIN assign a role', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      const facultyUser = await prisma.user.findUniqueOrThrow({ where: { email: facultyEmail } });

      const res = await request(app.getHttpServer())
        .post(`/users/${facultyUser.id}/roles`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({ role: 'INVIGILATOR' })
        .expect(201);

      expect(res.body.roles).toEqual(expect.arrayContaining(['FACULTY', 'INVIGILATOR']));
    });

    it('rejects a non-existent role name', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(200);

      const facultyUser = await prisma.user.findUniqueOrThrow({ where: { email: facultyEmail } });

      await request(app.getHttpServer())
        .post(`/users/${facultyUser.id}/roles`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({ role: 'NOT_A_REAL_ROLE' })
        .expect(400);
    });

    it('rejects a non-ADMIN caller', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: facultyEmail, password })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/users/${login.body.access_token}/roles`) // any id — should 403 before reaching a lookup
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({ role: 'ADMIN' })
        .expect(403);
    });
  });

  describe('GET /health remains public', () => {
    it('does not require authentication (Phase 0 regression check)', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });
});
