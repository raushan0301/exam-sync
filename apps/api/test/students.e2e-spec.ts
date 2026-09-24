import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Students (e2e) — Phase 3', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p3-admin@test.local';
  const facultyEmail = 'e2e-p3-faculty@test.local';
  const password = 'CorrectHorseBatteryStaple1!';

  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P3-${suffix}`;
  const progCode = `BTCSE-P3-${suffix}`;
  const otherProgCode = `BTECE-P3-${suffix}`;

  let departmentId: string;
  let programId: string;
  let otherProgramId: string;
  let batchId: string;
  let otherProgramBatchId: string;

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

    adminToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password }).expect(200)
    ).body.access_token;
    facultyToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: facultyEmail, password }).expect(200)
    ).body.access_token;

    // Academic-structure fixtures this suite needs.
    const dept = await prisma.department.create({ data: { name: 'CSE', code: deptCode } });
    departmentId = dept.id;
    const prog = await prisma.program.create({
      data: { departmentId, name: 'B.Tech CSE', code: progCode },
    });
    programId = prog.id;
    const otherProg = await prisma.program.create({
      data: { departmentId, name: 'B.Tech ECE', code: otherProgCode },
    });
    otherProgramId = otherProg.id;
    const batch = await prisma.batch.create({ data: { programId, year: '2026', section: 'A', subsection: 'A' } });
    batchId = batch.id;
    const otherBatch = await prisma.batch.create({
      data: { programId: otherProgramId, year: '2026', section: 'A', subsection: 'A' },
    });
    otherProgramBatchId = otherBatch.id;
  });

  afterAll(async () => {
    await prisma.student.deleteMany({ where: { program: { code: { in: [progCode, otherProgCode] } } } });
    const testEmails = [
      adminEmail,
      facultyEmail,
      `ada-${suffix}@test.local`,
      `bulk1-${suffix}@test.local`,
      `bulk2-${suffix}@test.local`,
      `x3-${suffix}@test.local`,
    ];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.batch.deleteMany({ where: { program: { code: { in: [progCode, otherProgCode] } } } });
    await prisma.program.deleteMany({ where: { code: { in: [progCode, otherProgCode] } } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  let studentId: string;
  let studentToken: string;

  describe('POST /students', () => {
    it('rejects unauthenticated / non-ADMIN creation', async () => {
      await request(app.getHttpServer())
        .post('/students')
        .send({ name: 'X', email: 'x@test.local', program_id: programId, batch_id: batchId, roll_number: 'R1' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ name: 'X', email: 'x@test.local', program_id: programId, batch_id: batchId, roll_number: 'R1' })
        .expect(403);
    });

    it('rejects a batch that does not belong to the given program (data-integrity check)', async () => {
      await request(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Mismatch',
          email: `mismatch-${suffix}@test.local`,
          program_id: programId,
          batch_id: otherProgramBatchId, // belongs to otherProgramId, not programId
          roll_number: `MISMATCH-${suffix}`,
        })
        .expect(409);
    });

    it('creates a student, atomically provisioning a STUDENT-role User, never returning a password', async () => {
      const res = await request(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Ada Lovelace',
          email: `ada-${suffix}@test.local`,
          program_id: programId,
          batch_id: batchId,
          roll_number: `ADA-${suffix}`,
        })
        .expect(201);

      studentId = res.body.id;
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ada-${suffix}@test.local`, password: 'this-is-not-the-real-temp-password' })
        .expect(401); // proves the account exists and is real (generic invalid-credentials, not account-not-found-shaped)
      expect(login.body.message).toBe('Invalid email or password.');

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: `ada-${suffix}@test.local` } });
      const roles = await prisma.userRole.findMany({ where: { userId: dbUser.id }, include: { role: true } });
      expect(roles.map((r) => r.role.name)).toContain('STUDENT');

      // Log in as the real student for the resource-level auth tests below.
      // We don't know the random temp password, so forge a session the
      // same way any e2e fixture does: set a known password directly.
      const knownHash = await argon2.hash(password, { type: argon2.argon2id });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash: knownHash } });
      studentToken = (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: `ada-${suffix}@test.local`, password })
          .expect(200)
      ).body.access_token;
    });

    it('rejects a duplicate roll_number with 409', async () => {
      await request(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dup',
          email: `dup-${suffix}@test.local`,
          program_id: programId,
          batch_id: batchId,
          roll_number: `ADA-${suffix}`,
        })
        .expect(409);
    });

    it('rejects a non-existent program with 404', async () => {
      await request(app.getHttpServer())
        .post('/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'X',
          email: `x2-${suffix}@test.local`,
          program_id: '00000000-0000-0000-0000-000000000000',
          batch_id: batchId,
          roll_number: `X2-${suffix}`,
        })
        .expect(404);
    });
  });

  describe('GET /students/:id — resource-level authorization (BR-045, EC-038)', () => {
    it('lets the student read their own record', async () => {
      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
      expect(res.body.id).toBe(studentId);
    });

    it('lets ADMIN read any student record', async () => {
      await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('blocks an unrelated FACULTY user with 404 (Phase 5 extension point not yet implemented, not a 403)', async () => {
      await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(`/students/${studentId}`).expect(401);
    });
  });

  describe('GET /students (list) — ADMIN only', () => {
    it('rejects a non-ADMIN', async () => {
      await request(app.getHttpServer())
        .get('/students')
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });

    it('supports search + pagination shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/students')
        .query({ search: `ADA-${suffix}` })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.items.some((s: any) => s.id === studentId)).toBe(true);
      expect(res.body).toHaveProperty('next_cursor');
    });
  });

  describe('PATCH /students/:id — deactivation (FR-005)', () => {
    it('deactivating blocks the linked login (soft delete, never physical)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(res.body.status).toBe('INACTIVE');

      // Row still exists — soft delete, not physical.
      const stillThere = await prisma.student.findUnique({ where: { id: studentId } });
      expect(stillThere).not.toBeNull();

      // Login now blocked, but with the SAME generic error as any other
      // login failure (never reveals "this account is disabled").
      const loginAttempt = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ada-${suffix}@test.local`, password })
        .expect(401);
      expect(loginAttempt.body.message).toBe('Invalid email or password.');
    });

    it('reactivating restores the login', async () => {
      await request(app.getHttpServer())
        .patch(`/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ada-${suffix}@test.local`, password })
        .expect(200);
    });
  });

  describe('POST /students/bulk-import (EC-044 partial failure)', () => {
    it('rejects a non-ADMIN', async () => {
      await request(app.getHttpServer())
        .post('/students/bulk-import')
        .set('Authorization', `Bearer ${facultyToken}`)
        .attach('file', Buffer.from('name,email,program_id,batch_id,roll_number\n'), 'students.csv')
        .expect(403);
    });

    it('processes valid rows and reports invalid rows individually, never all-or-nothing', async () => {
      const csv =
        'name,email,program_id,batch_id,roll_number\n' +
        `Bulk One,bulk1-${suffix}@test.local,${programId},${batchId},BULK1-${suffix}\n` +
        `Bulk Two,bulk2-${suffix}@test.local,00000000-0000-0000-0000-000000000000,${batchId},BULK2-${suffix}\n`;

      const res = await request(app.getHttpServer())
        .post('/students/bulk-import')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csv), 'students.csv')
        .expect(202);

      expect(res.body.job_id).toEqual(expect.any(String));

      const jobRes = await request(app.getHttpServer())
        .get(`/import-jobs/${res.body.job_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(jobRes.body.totalRows).toBe(2);
      expect(jobRes.body.successCount).toBe(1);
      expect(jobRes.body.failureCount).toBe(1);
      expect(jobRes.body.results).toHaveLength(2);

      // The valid row's student must actually exist now.
      const created = await prisma.student.findUnique({ where: { rollNumber: `BULK1-${suffix}` } });
      expect(created).not.toBeNull();
      const failed = await prisma.student.findUnique({ where: { rollNumber: `BULK2-${suffix}` } });
      expect(failed).toBeNull();
    });

    it('a non-ADMIN cannot poll an import job', async () => {
      const csv = `name,email,program_id,batch_id,roll_number\nX,x3-${suffix}@test.local,${programId},${batchId},X3-${suffix}\n`;
      const res = await request(app.getHttpServer())
        .post('/students/bulk-import')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csv), 'students.csv')
        .expect(202);

      await request(app.getHttpServer())
        .get(`/import-jobs/${res.body.job_id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });
  });
});
