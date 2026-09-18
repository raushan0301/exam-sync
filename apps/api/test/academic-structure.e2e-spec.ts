import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Academic Structure (e2e) — Phase 2', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p2-admin@test.local';
  const facultyEmail = 'e2e-p2-faculty@test.local';
  const password = 'CorrectHorseBatteryStaple1!';

  // A unique run-scoped suffix keeps this suite re-runnable without
  // colliding with leftover data from a previous (possibly crashed) run.
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-${suffix}`;
  const progCode = `BTCSE-${suffix}`;
  const subjectCode = `DBMS-${suffix}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.userRole.deleteMany({ where: { user: { email: { in: [adminEmail, facultyEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, facultyEmail] } } }).catch(() => undefined);

    for (const name of ['ADMIN', 'FACULTY', 'STUDENT', 'INVIGILATOR']) {
      await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const facultyRole = await prisma.role.findUniqueOrThrow({ where: { name: 'FACULTY' } });

    const admin = await prisma.user.upsert({ where: { email: adminEmail }, create: { email: adminEmail, passwordHash, isActive: true }, update: {} });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } }, create: { userId: admin.id, roleId: adminRole.id }, update: {} });

    const faculty = await prisma.user.upsert({ where: { email: facultyEmail }, create: { email: facultyEmail, passwordHash, isActive: true }, update: {} });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: faculty.id, roleId: facultyRole.id } }, create: { userId: faculty.id, roleId: facultyRole.id }, update: {} });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = adminLogin.body.access_token;

    const facultyLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: facultyEmail, password })
      .expect(200);
    facultyToken = facultyLogin.body.access_token;
  });

  afterAll(async () => {
    await prisma.subject.deleteMany({ where: { code: { startsWith: 'DBMS-' + suffix } } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: [adminEmail, facultyEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, facultyEmail] } } }).catch(() => undefined);
    await app.close();
  });

  let departmentId: string;
  let programId: string;
  let batchId: string;
  let subjectId: string;

  describe('Departments', () => {
    it('rejects an unauthenticated create', async () => {
      await request(app.getHttpServer())
        .post('/departments')
        .send({ name: 'CSE', code: deptCode })
        .expect(401);
    });

    it('rejects a non-ADMIN (FACULTY) create with 403', async () => {
      await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ name: 'CSE', code: deptCode })
        .expect(403);
    });

    it('lets an ADMIN create a department', async () => {
      const res = await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Computer Science & Engineering', code: deptCode })
        .expect(201);

      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.code).toBe(deptCode);
      expect(res.body.status).toBe('ACTIVE');
      departmentId = res.body.id;
    });

    it('rejects a duplicate department code with 409 (BR-001, DB-enforced)', async () => {
      await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Duplicate CSE', code: deptCode })
        .expect(409);
    });

    it('any authenticated role (not just ADMIN) can read', async () => {
      await request(app.getHttpServer())
        .get(`/departments/${departmentId}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);
    });

    it('supports search by code', async () => {
      const res = await request(app.getHttpServer())
        .get('/departments')
        .query({ search: deptCode })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.some((d: any) => d.id === departmentId)).toBe(true);
    });

    it('supports filtering by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/departments')
        .query({ status: 'ACTIVE', search: deptCode })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.every((d: any) => d.status === 'ACTIVE')).toBe(true);
    });

    it('supports cursor pagination shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/departments')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('next_cursor');
    });

    it('rejects a non-ADMIN update with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/departments/${departmentId}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ name: 'x' })
        .expect(403);
    });

    it('lets an ADMIN deactivate the department (soft delete, not physical)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/departments/${departmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(res.body.status).toBe('INACTIVE');

      // Row must still exist (soft delete, never a physical DELETE).
      const stillThere = await prisma.department.findUnique({ where: { id: departmentId } });
      expect(stillThere).not.toBeNull();
    });

    it('reactivates it back to ACTIVE for the rest of the suite', async () => {
      await request(app.getHttpServer())
        .patch(`/departments/${departmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('404s for a non-existent department id', async () => {
      await request(app.getHttpServer())
        .get('/departments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Programs', () => {
    it('rejects creation against a non-existent department with 404', async () => {
      await request(app.getHttpServer())
        .post('/programs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          department_id: '00000000-0000-0000-0000-000000000000',
          name: 'B.Tech CSE',
          code: progCode,
        })
        .expect(404);
    });

    it('creates a program under the department', async () => {
      const res = await request(app.getHttpServer())
        .post('/programs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: departmentId, name: 'B.Tech CSE', code: progCode })
        .expect(201);

      programId = res.body.id;
      expect(res.body.department_id ?? res.body.departmentId).toBeTruthy();
    });

    it('rejects a duplicate program code with 409', async () => {
      await request(app.getHttpServer())
        .post('/programs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: departmentId, name: 'Dup', code: progCode })
        .expect(409);
    });

    it('lists programs filterable by department_id', async () => {
      const res = await request(app.getHttpServer())
        .get('/programs')
        .query({ department_id: departmentId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.some((p: any) => p.id === programId)).toBe(true);
    });

    it('deactivates the program', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/programs/${programId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('reactivates it for the rest of the suite', async () => {
      await request(app.getHttpServer())
        .patch(`/programs/${programId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });
  });

  describe('Batches', () => {
    it('rejects creation against a non-existent program with 404', async () => {
      await request(app.getHttpServer())
        .post('/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ program_id: '00000000-0000-0000-0000-000000000000', year: 2026, section: 'A' })
        .expect(404);
    });

    it('creates a batch under the program', async () => {
      const res = await request(app.getHttpServer())
        .post('/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ program_id: programId, year: 2026, section: 'A' })
        .expect(201);
      batchId = res.body.id;
    });

    it('rejects a duplicate (program_id, year, section) with 409', async () => {
      await request(app.getHttpServer())
        .post('/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ program_id: programId, year: 2026, section: 'A' })
        .expect(409);
    });

    it('allows a different section for the same program/year (proves the uniqueness is on the TRIPLE, not just program+year)', async () => {
      const res = await request(app.getHttpServer())
        .post('/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ program_id: programId, year: 2026, section: 'B' })
        .expect(201);

      // cleanup this extra one immediately, it's only needed for this assertion
      await prisma.batch.delete({ where: { id: res.body.id } });
    });

    it('deactivates the batch', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/batches/${batchId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('reactivates it', async () => {
      await request(app.getHttpServer())
        .patch(`/batches/${batchId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });
  });

  describe('Subjects', () => {
    it('rejects creation against a non-existent department with 404', async () => {
      await request(app.getHttpServer())
        .post('/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: '00000000-0000-0000-0000-000000000000', code: subjectCode, name: 'DBMS' })
        .expect(404);
    });

    it('creates a subject with only a department (program_id is nullable)', async () => {
      const res = await request(app.getHttpServer())
        .post('/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: departmentId, code: subjectCode, name: 'Database Management Systems', credits: 4 })
        .expect(201);

      subjectId = res.body.id;
      expect(res.body.is_active ?? res.body.isActive).toBe(true);
    });

    it('rejects a duplicate subject code with 409', async () => {
      await request(app.getHttpServer())
        .post('/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: departmentId, code: subjectCode, name: 'Dup' })
        .expect(409);
    });

    it('rejects an invalid program_id with 404 when one IS supplied', async () => {
      await request(app.getHttpServer())
        .post('/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          department_id: departmentId,
          program_id: '00000000-0000-0000-0000-000000000000',
          code: `${subjectCode}-2`,
          name: 'X',
        })
        .expect(404);
    });

    it('deactivates the subject via is_active (boolean, not status)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/subjects/${subjectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200);

      expect(res.body.is_active ?? res.body.isActive).toBe(false);
    });
  });

  describe('Database integrity', () => {
    it('never allows subject/program/batch input validation to reach the DB with a malformed UUID', async () => {
      await request(app.getHttpServer())
        .post('/programs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ department_id: 'not-a-uuid', name: 'X', code: 'X' })
        .expect(400);
    });

    it('rejects unknown fields (forbidNonWhitelisted) rather than silently ignoring them', async () => {
      await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'X', code: `X-${suffix}`, unexpectedField: 'should be rejected' })
        .expect(400);
    });
  });
});
