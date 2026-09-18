import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Faculty (e2e) — Phase 4', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string;

  const adminEmail = 'e2e-p4-admin@test.local';
  const studentUserEmail = 'e2e-p4-studentuser@test.local';
  const password = 'CorrectHorseBatteryStaple1!';

  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P4-${suffix}`;

  let departmentId: string;
  let facultyId: string;
  let facultyToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.userRole.deleteMany({ where: { user: { email: { in: [adminEmail, studentUserEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, studentUserEmail] } } }).catch(() => undefined);

    for (const name of ['ADMIN', 'FACULTY', 'STUDENT', 'INVIGILATOR']) {
      await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });

    const admin = await prisma.user.upsert({ where: { email: adminEmail }, create: { email: adminEmail, passwordHash, isActive: true }, update: {} });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } }, create: { userId: admin.id, roleId: adminRole.id }, update: {} });

    const studentUser = await prisma.user.upsert({ where: { email: studentUserEmail }, create: { email: studentUserEmail, passwordHash, isActive: true }, update: {} });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: studentUser.id, roleId: studentRole.id } }, create: { userId: studentUser.id, roleId: studentRole.id }, update: {} });

    adminToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password }).expect(200)
    ).body.access_token;
    studentToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: studentUserEmail, password }).expect(200)
    ).body.access_token;

    const dept = await prisma.department.create({ data: { name: 'CSE', code: deptCode } });
    departmentId = dept.id;
  });

  afterAll(async () => {
    const testEmails = [adminEmail, studentUserEmail, `grace-${suffix}@test.local`];
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  describe('POST /faculty', () => {
    it('rejects unauthenticated / non-ADMIN creation', async () => {
      await request(app.getHttpServer())
        .post('/faculty')
        .send({ name: 'X', email: 'x@test.local', department_id: departmentId, employee_code: 'E1' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/faculty')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ name: 'X', email: 'x@test.local', department_id: departmentId, employee_code: 'E1' })
        .expect(403);
    });

    it('rejects a non-existent department with 404', async () => {
      await request(app.getHttpServer())
        .post('/faculty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'X',
          email: `x2-${suffix}@test.local`,
          department_id: '00000000-0000-0000-0000-000000000000',
          employee_code: `X2-${suffix}`,
        })
        .expect(404);
    });

    it('creates a faculty member, atomically provisioning a FACULTY-role User, never returning a password', async () => {
      const res = await request(app.getHttpServer())
        .post('/faculty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dr. Grace Hopper',
          email: `grace-${suffix}@test.local`,
          department_id: departmentId,
          employee_code: `GRACE-${suffix}`,
        })
        .expect(201);

      facultyId = res.body.id;
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: `grace-${suffix}@test.local` } });
      const roles = await prisma.userRole.findMany({ where: { userId: dbUser.id }, include: { role: true } });
      expect(roles.map((r) => r.role.name)).toContain('FACULTY');

      const knownHash = await argon2.hash(password, { type: argon2.argon2id });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash: knownHash } });
      facultyToken = (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: `grace-${suffix}@test.local`, password })
          .expect(200)
      ).body.access_token;
    });

    it('rejects a duplicate employee_code with 409', async () => {
      await request(app.getHttpServer())
        .post('/faculty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dup',
          email: `dup-${suffix}@test.local`,
          department_id: departmentId,
          employee_code: `GRACE-${suffix}`,
        })
        .expect(409);
    });
  });

  describe('GET /faculty/:id — resource-level authorization', () => {
    it('lets the faculty member read their own record', async () => {
      const res = await request(app.getHttpServer())
        .get(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);
      expect(res.body.id).toBe(facultyId);
    });

    it('lets ADMIN read any faculty record', async () => {
      await request(app.getHttpServer())
        .get(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('blocks an unrelated user with 404, not 403 (IDOR-safe)', async () => {
      await request(app.getHttpServer())
        .get(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(`/faculty/${facultyId}`).expect(401);
    });
  });

  describe('GET /faculty (list) — ADMIN only', () => {
    it('rejects a non-ADMIN', async () => {
      await request(app.getHttpServer())
        .get('/faculty')
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });

    it('supports search + pagination shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/faculty')
        .query({ search: `GRACE-${suffix}` })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.items.some((f: any) => f.id === facultyId)).toBe(true);
      expect(res.body).toHaveProperty('next_cursor');
    });
  });

  describe('PATCH /faculty/:id — deactivation (mirrors FR-005 for faculty)', () => {
    it('deactivating blocks the linked login without revealing why (soft delete, never physical)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(res.body.status).toBe('INACTIVE');

      const stillThere = await prisma.faculty.findUnique({ where: { id: facultyId } });
      expect(stillThere).not.toBeNull();

      const loginAttempt = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `grace-${suffix}@test.local`, password })
        .expect(401);
      expect(loginAttempt.body.message).toBe('Invalid email or password.');
    });

    it('reactivating restores the login', async () => {
      await request(app.getHttpServer())
        .patch(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `grace-${suffix}@test.local`, password })
        .expect(200);
    });

    it('rejects a non-ADMIN update', async () => {
      await request(app.getHttpServer())
        .patch(`/faculty/${facultyId}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ name: 'Self promoted' })
        .expect(403);
    });
  });
});
