import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EnrollmentsService } from '../src/modules/enrollment';

describe('Faculty-Subject-Batch Assignment + Enrollment (e2e) — Phase 5', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminEmail = 'e2e-p5-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P5-${suffix}`;
  const progCode = `BTCSE-P5-${suffix}`;

  let departmentId: string;
  let programId: string;
  let batchAId: string;
  let batchBId: string;
  let batchCId: string;
  let dbmsSubjectId: string;

  // Faculty A teaches DBMS to Batch A and B; Faculty B teaches DBMS to Batch C
  // (this exact scenario is IMPLEMENTATION_PLAN.md Phase 5's own named
  // acceptance criterion).
  let facultyAId: string;
  let facultyAToken: string;
  let facultyBId: string;
  let facultyBToken: string;

  // A student in Batch A who is NOT enrolled in DBMS (tests BR-005 directly
  // against a real HTTP-reachable eligibility signal).
  let studentInBatchANotEnrolledId: string;
  let studentInBatchANotEnrolledToken: string;

  // A student in Batch A who IS enrolled in DBMS.
  let enrolledStudentId: string;
  let enrolledStudentToken: string;
  let enrollmentId: string;

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

    for (const name of ['ADMIN', 'FACULTY', 'STUDENT', 'INVIGILATOR']) {
      await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, isActive: true },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      create: { userId: admin.id, roleId: adminRole.id },
      update: {},
    });

    adminToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password }).expect(200)
    ).body.access_token;

    // --- Academic structure fixtures ---
    const dept = await prisma.department.create({ data: { name: 'CSE', code: deptCode } });
    departmentId = dept.id;
    const prog = await prisma.program.create({ data: { departmentId, name: 'B.Tech CSE', code: progCode } });
    programId = prog.id;
    const batchA = await prisma.batch.create({ data: { programId, year: 2026, section: 'A' } });
    batchAId = batchA.id;
    const batchB = await prisma.batch.create({ data: { programId, year: 2026, section: 'B' } });
    batchBId = batchB.id;
    const batchC = await prisma.batch.create({ data: { programId, year: 2026, section: 'C' } });
    batchCId = batchC.id;
    const dbms = await prisma.subject.create({
      data: { departmentId, code: `DBMS-${suffix}`, name: 'Database Management Systems' },
    });
    dbmsSubjectId = dbms.id;

    // --- Faculty A & B, provisioned via the real API ---
    const facultyARes = await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty A', email: `facultyA-${suffix}@test.local`, department_id: departmentId, employee_code: `FACA-${suffix}` })
      .expect(201);
    facultyAId = facultyARes.body.id;

    const facultyBRes = await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty B', email: `facultyB-${suffix}@test.local`, department_id: departmentId, employee_code: `FACB-${suffix}` })
      .expect(201);
    facultyBId = facultyBRes.body.id;

    for (const [userEmail, setter] of [
      [`facultyA-${suffix}@test.local`, (t: string) => (facultyAToken = t)],
      [`facultyB-${suffix}@test.local`, (t: string) => (facultyBToken = t)],
    ] as const) {
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password })
        .expect(200);
      setter(login.body.access_token);
    }

    // --- Students, provisioned via the real API ---
    const notEnrolledRes = await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Not Enrolled Student',
        email: `notenrolled-${suffix}@test.local`,
        program_id: programId,
        batch_id: batchAId,
        roll_number: `NOTENR-${suffix}`,
      })
      .expect(201);
    studentInBatchANotEnrolledId = notEnrolledRes.body.id;

    const enrolledRes = await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Enrolled Student',
        email: `enrolled-${suffix}@test.local`,
        program_id: programId,
        batch_id: batchAId,
        roll_number: `ENR-${suffix}`,
      })
      .expect(201);
    enrolledStudentId = enrolledRes.body.id;

    for (const [userEmail, setter] of [
      [`notenrolled-${suffix}@test.local`, (t: string) => (studentInBatchANotEnrolledToken = t)],
      [`enrolled-${suffix}@test.local`, (t: string) => (enrolledStudentToken = t)],
    ] as const) {
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password })
        .expect(200);
      setter(login.body.access_token);
    }
  });

  afterAll(async () => {
    await prisma.studentSubjectEnrollment.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.student.deleteMany({ where: { program: { code: progCode } } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [
      adminEmail,
      `facultyA-${suffix}@test.local`,
      `facultyB-${suffix}@test.local`,
      `notenrolled-${suffix}@test.local`,
      `enrolled-${suffix}@test.local`,
    ];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.subject.deleteMany({ where: { code: `DBMS-${suffix}` } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  describe('POST /faculty-assignments — the named acceptance scenario', () => {
    it('rejects unauthenticated / non-ADMIN creation (BR-007)', async () => {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(403);
    });

    it('"Faculty A teaches DBMS to Batch A and B; Faculty B teaches DBMS to Batch C" is representable', async () => {
      const a1 = await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(201);

      const a2 = await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batchBId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(201);

      const b1 = await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyBId, subject_id: dbmsSubjectId, batch_id: batchCId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(201);

      expect(a1.body.id).not.toBe(a2.body.id);
      expect(a2.body.id).not.toBe(b1.body.id);

      // ...and it is QUERYABLE: GET /faculty/{A}/assignments lists exactly
      // the two rows for Faculty A (Batch A + Batch B), not Faculty B's.
      const listA = await request(app.getHttpServer())
        .get(`/faculty/${facultyAId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(listA.body.items).toHaveLength(2);
      expect(listA.body.items.map((r: any) => r.batchId ?? r.batch_id).sort()).toEqual(
        [batchAId, batchBId].sort(),
      );

      const listB = await request(app.getHttpServer())
        .get(`/faculty/${facultyBId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(listB.body.items).toHaveLength(1);
      expect(listB.body.items[0].batchId ?? listB.body.items[0].batch_id).toBe(batchCId);
    });

    it('rejects an exact duplicate assignment with 409 (BR-009)', async () => {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(409);
    });

    it('rejects a non-existent faculty/subject/batch with 404', async () => {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          faculty_id: '00000000-0000-0000-0000-000000000000',
          subject_id: dbmsSubjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
          role: 'PRIMARY_INSTRUCTOR',
        })
        .expect(404);
    });

    it('GET /faculty/{id}/assignments — self or ADMIN (a faculty can see their own, not another\'s)', async () => {
      await request(app.getHttpServer())
        .get(`/faculty/${facultyAId}/assignments`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/faculty/${facultyAId}/assignments`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });
  });

  describe('DELETE /faculty-assignments/:id — soft end, never physical delete', () => {
    let toEndId: string;

    it('ends an assignment (sets an end date, row remains queryable in the DB)', async () => {
      const created = await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyBId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2027', semester: 1, role: 'CO_INSTRUCTOR' })
        .expect(201);
      toEndId = created.body.id;

      const ended = await request(app.getHttpServer())
        .delete(`/faculty-assignments/${toEndId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(ended.body.endedAt ?? ended.body.ended_at).toBeTruthy();

      const stillThere = await prisma.facultySubjectBatchAssignment.findUnique({ where: { id: toEndId } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.endedAt).not.toBeNull();
    });

    it('rejects ending it a second time with 409', async () => {
      await request(app.getHttpServer())
        .delete(`/faculty-assignments/${toEndId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('rejects a non-ADMIN', async () => {
      await request(app.getHttpServer())
        .delete(`/faculty-assignments/${toEndId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(403);
    });
  });

  describe('POST /enrollments — BR-004/005/006, the highest-leverage correctness surface', () => {
    it('rejects unauthenticated creation', async () => {
      await request(app.getHttpServer())
        .post('/enrollments')
        .send({ student_id: enrolledStudentId, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1 })
        .expect(401);
    });

    it('allows BOTH ADMIN and FACULTY to create an enrollment', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${facultyAToken}`) // FACULTY, not ADMIN
        .send({
          student_id: enrolledStudentId,
          subject_id: dbmsSubjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
        })
        .expect(201);
      enrollmentId = res.body.id;
      expect(res.body.status).toBe('ENROLLED');
    });

    it('rejects a STUDENT caller (only ADMIN/FACULTY may create)', async () => {
      await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${studentInBatchANotEnrolledToken}`)
        .send({
          student_id: studentInBatchANotEnrolledId,
          subject_id: dbmsSubjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
        })
        .expect(403);
    });

    it('rejects a duplicate (student, subject, year, semester) with 409 — BR-004', async () => {
      await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          student_id: enrolledStudentId,
          subject_id: dbmsSubjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
        })
        .expect(409);
    });

    it('rejects a non-existent student/subject/batch with 404', async () => {
      await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          student_id: '00000000-0000-0000-0000-000000000000',
          subject_id: dbmsSubjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
        })
        .expect(404);
    });
  });

  describe('THE central BR-005 test: batch membership alone yields ZERO eligibility', () => {
    it('a student in the SAME batch as an enrolled student, but with NO enrollment row, is NOT enrolled', async () => {
      // Both students are in batchAId. Only enrolledStudentId has a DBMS
      // enrollment row. studentInBatchANotEnrolledId shares the batch but
      // was never individually enrolled — BR-005 says that must NOT grant
      // eligibility.
      const enrollmentsService = app.get(EnrollmentsService);
      await expect(
        enrollmentsService.isEnrolled(studentInBatchANotEnrolledId, dbmsSubjectId, '2026', 1),
      ).resolves.toBe(false);

      await expect(
        enrollmentsService.isEnrolled(enrolledStudentId, dbmsSubjectId, '2026', 1),
      ).resolves.toBe(true);
    });

    it('GET /students/{id}/enrollments for the non-enrolled student returns an empty list, not an error and not inferred eligibility', async () => {
      const res = await request(app.getHttpServer())
        .get(`/students/${studentInBatchANotEnrolledId}/enrollments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('GET /students/{id}/enrollments for the enrolled student returns exactly their one enrollment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}/enrollments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(enrollmentId);
    });
  });

  describe('GET /students/{id}/enrollments — resource-level authorization (self / ADMIN / teaching FACULTY)', () => {
    it('lets the student read their own enrollments', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}/enrollments`)
        .set('Authorization', `Bearer ${enrolledStudentToken}`)
        .expect(200);
    });

    it('lets Faculty A (who teaches Batch A) read the enrollments of a student in Batch A', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}/enrollments`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
    });

    it('blocks Faculty B (who does NOT teach Batch A) with 404, not 403', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}/enrollments`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });

    it('blocks an unrelated student with 404', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}/enrollments`)
        .set('Authorization', `Bearer ${studentInBatchANotEnrolledToken}`)
        .expect(404);
    });
  });

  describe('GET /students/{id} — Phase 3\'s TODO, now fulfilled by Phase 5', () => {
    it('Faculty A (teaches Batch A) can now read the profile of a student in Batch A', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
    });

    it('Faculty B (does not teach Batch A) still cannot', async () => {
      await request(app.getHttpServer())
        .get(`/students/${enrolledStudentId}`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });
  });

  describe('PATCH /enrollments/:id — DROPPED status (BR-006)', () => {
    it('rejects a non-ADMIN (FACULTY may create enrollments but not modify their status)', async () => {
      await request(app.getHttpServer())
        .patch(`/enrollments/${enrollmentId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ status: 'DROPPED' })
        .expect(403);
    });

    it('drops the enrollment; the student is then no longer eligible (isEnrolled -> false)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/enrollments/${enrollmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DROPPED' })
        .expect(200);
      expect(res.body.status).toBe('DROPPED');
      expect(res.body.droppedAt ?? res.body.dropped_at).toBeTruthy();

      const enrollmentsService = app.get(EnrollmentsService);
      await expect(
        enrollmentsService.isEnrolled(enrolledStudentId, dbmsSubjectId, '2026', 1),
      ).resolves.toBe(false);
    });
  });

  describe('POST /enrollments/bulk — EC-044 partial failure', () => {
    it('rejects a non-ADMIN', async () => {
      await request(app.getHttpServer())
        .post('/enrollments/bulk')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ enrollments: [] })
        .expect(403);
    });

    it('processes valid rows and reports invalid rows individually', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          enrollments: [
            {
              student_id: studentInBatchANotEnrolledId,
              subject_id: dbmsSubjectId,
              batch_id: batchAId,
              academic_year: '2029',
              semester: 1,
            },
            {
              student_id: '00000000-0000-0000-0000-000000000000',
              subject_id: dbmsSubjectId,
              batch_id: batchAId,
              academic_year: '2029',
              semester: 1,
            },
          ],
        })
        .expect(202);

      expect(res.body.job_id).toEqual(expect.any(String));

      const jobRes = await request(app.getHttpServer())
        .get(`/import-jobs/${res.body.job_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(jobRes.body.totalRows).toBe(2);
      expect(jobRes.body.successCount).toBe(1);
      expect(jobRes.body.failureCount).toBe(1);
    });
  });
});
