import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Quiz Management (e2e) — Phase 6', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminEmail = 'e2e-p6-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P6-${suffix}`;
  const progCode = `BTCSE-P6-${suffix}`;

  let departmentId: string;
  let programId: string;
  let batchAId: string;
  let batchBId: string;
  let dbmsSubjectId: string;
  let osSubjectId: string;

  // Faculty A is assigned DBMS/Batch A; Faculty B has no assignments at all.
  let facultyAId: string;
  let facultyAToken: string;
  let facultyBToken: string;

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

    const dept = await prisma.department.create({ data: { name: 'CSE', code: deptCode } });
    departmentId = dept.id;
    const prog = await prisma.program.create({ data: { departmentId, name: 'B.Tech CSE', code: progCode } });
    programId = prog.id;
    const batchA = await prisma.batch.create({ data: { programId, year: 2026, section: 'A' } });
    batchAId = batchA.id;
    const batchB = await prisma.batch.create({ data: { programId, year: 2026, section: 'B' } });
    batchBId = batchB.id;
    const dbms = await prisma.subject.create({
      data: { departmentId, code: `DBMS-${suffix}`, name: 'Database Management Systems' },
    });
    dbmsSubjectId = dbms.id;
    const os = await prisma.subject.create({
      data: { departmentId, code: `OS-${suffix}`, name: 'Operating Systems' },
    });
    osSubjectId = os.id;

    const facultyARes = await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty A', email: `facultyA-${suffix}@test.local`, department_id: departmentId, employee_code: `FACA-${suffix}` })
      .expect(201);
    facultyAId = facultyARes.body.id;

    await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty B', email: `facultyB-${suffix}@test.local`, department_id: departmentId, employee_code: `FACB-${suffix}` })
      .expect(201);

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

    // Faculty A is assigned to teach DBMS to Batch A for 2026/semester 1.
    await request(app.getHttpServer())
      .post('/faculty-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        faculty_id: facultyAId,
        subject_id: dbmsSubjectId,
        batch_id: batchAId,
        academic_year: '2026',
        semester: 1,
        role: 'PRIMARY_INSTRUCTOR',
      })
      .expect(201);
  });

  afterAll(async () => {
    // quiz_approval_history (added in Phase 7) FK-references quizzes and
    // must be cleared first — this suite's own submit() calls now create
    // history rows, which Phase 6 predates.
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`, `facultyB-${suffix}@test.local`];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.subject.deleteMany({ where: { code: { in: [`DBMS-${suffix}`, `OS-${suffix}`] } } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  let draftQuizId: string;
  let draftQuizVersion: number;

  describe('POST /quizzes — BR-010', () => {
    it('rejects unauthenticated / non-FACULTY creation', async () => {
      await request(app.getHttpServer())
        .post('/quizzes')
        .send({ title: 'X', subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
        .expect(401);

      await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'X', subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
        .expect(403); // ADMIN cannot create quizzes — this is a FACULTY-only action
    });

    it('403s Faculty B, who has NO assignment for DBMS/Batch A at all', async () => {
      await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyBToken}`)
        .send({ title: 'Unauthorized Quiz', subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
        .expect(403);
    });

    it('403s Faculty A for a batch they ARE NOT assigned to (Batch B), even though they teach DBMS to Batch A', async () => {
      await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ title: 'Wrong Batch', subject_id: dbmsSubjectId, batch_ids: [batchBId], academic_year: '2026', semester: 1 })
        .expect(403);
    });

    it('403s Faculty A for a DIFFERENT subject (OS) even though they teach DBMS', async () => {
      await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ title: 'Wrong Subject', subject_id: osSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
        .expect(403);
    });

    it('creates a minimal DRAFT quiz for an authorized (subject, batch) pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({
          title: 'DBMS Quiz 1',
          subject_id: dbmsSubjectId,
          batch_ids: [batchAId],
          academic_year: '2026',
          semester: 1,
        })
        .expect(201);

      draftQuizId = res.body.id;
      draftQuizVersion = res.body.version;
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.version).toBe(1);
    });

    it('rejects creation for a non-existent subject/batch with 404', async () => {
      await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({
          title: 'X',
          subject_id: '00000000-0000-0000-0000-000000000000',
          batch_ids: [batchAId],
          academic_year: '2026',
          semester: 1,
        })
        .expect(404);
    });
  });

  describe('GET /quizzes/{id} and GET /quizzes — resource-level authorization (BR-046)', () => {
    it('lets the owning faculty view their own quiz', async () => {
      const res = await request(app.getHttpServer())
        .get(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(res.body.id).toBe(draftQuizId);
    });

    it('lets ADMIN view any quiz', async () => {
      await request(app.getHttpServer())
        .get(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('blocks an unrelated faculty (Faculty B) from viewing another faculty\'s DRAFT quiz — 404, not 403', async () => {
      await request(app.getHttpServer())
        .get(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });

    it('GET /quizzes list for Faculty A includes their quiz; for Faculty B it does not', async () => {
      const listA = await request(app.getHttpServer())
        .get('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(listA.body.items.some((q: any) => q.id === draftQuizId)).toBe(true);

      const listB = await request(app.getHttpServer())
        .get('/quizzes')
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(200);
      expect(listB.body.items.some((q: any) => q.id === draftQuizId)).toBe(false);
    });
  });

  describe('POST /quizzes/{id}/submit — 422 incomplete (the documented Phase 6 test case)', () => {
    it('422s because the minimal DRAFT is missing duration_minutes/total_marks/question_count/quiz_type/preferred_date/preferred_time', async () => {
      const res = await request(app.getHttpServer())
        .post(`/quizzes/${draftQuizId}/submit`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(422);
      expect(res.body.message).toMatch(/duration_minutes/);
    });

    it('rejects submission by anyone other than the owner, even a co-instructor-eligible faculty (submit is owner-only, narrower than PATCH)', async () => {
      await request(app.getHttpServer())
        .post(`/quizzes/${draftQuizId}/submit`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(403);
    });
  });

  describe('PATCH /quizzes/{id} — optimistic locking (BR-051) and completing the DRAFT', () => {
    it('rejects a stale If-Match version with 409', async () => {
      await request(app.getHttpServer())
        .patch(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', '999')
        .send({ duration_minutes: 60 })
        .expect(409);
    });

    it('rejects a missing If-Match header with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ duration_minutes: 60 })
        .expect(400);
    });

    it('blocks an unrelated faculty from editing — 404 (IDOR-safe)', async () => {
      await request(app.getHttpServer())
        .patch(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .set('If-Match', String(draftQuizVersion))
        .send({ title: 'Hijacked' })
        .expect(404);
    });

    it('fills in the remaining required fields, incrementing version each time', async () => {
      const res1 = await request(app.getHttpServer())
        .patch(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', String(draftQuizVersion))
        .send({
          duration_minutes: 60,
          total_marks: 100,
          question_count: 20,
          quiz_type: 'QUIZ',
          preferred_date: '2026-05-01',
          preferred_time: '10:00',
        })
        .expect(200);

      expect(res1.body.version).toBe(draftQuizVersion + 1);
      draftQuizVersion = res1.body.version;
    });
  });

  describe('POST /quizzes/{id}/submit — success path once complete', () => {
    it('transitions DRAFT -> SUBMITTED now that the quiz is complete', async () => {
      const res = await request(app.getHttpServer())
        .post(`/quizzes/${draftQuizId}/submit`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(201);
      expect(res.body.status).toBe('SUBMITTED');
    });

    it('rejects submitting it again — already SUBMITTED (409)', async () => {
      await request(app.getHttpServer())
        .post(`/quizzes/${draftQuizId}/submit`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(409);
    });

    it('rejects PATCHing a SUBMITTED quiz — no longer DRAFT (409)', async () => {
      const current = await prisma.quiz.findUniqueOrThrow({ where: { id: draftQuizId } });
      await request(app.getHttpServer())
        .patch(`/quizzes/${draftQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', String(current.version))
        .send({ title: 'Too late' })
        .expect(409);
    });
  });

  describe('BR-010 re-validated at submission time (assignment may change between create and submit)', () => {
    let secondQuizId: string;

    it('creates and completes a second quiz for Faculty A / DBMS / Batch A', async () => {
      const created = await request(app.getHttpServer())
        .post('/quizzes')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ title: 'DBMS Quiz 2', subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
        .expect(201);
      secondQuizId = created.body.id;

      await request(app.getHttpServer())
        .patch(`/quizzes/${secondQuizId}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', String(created.body.version))
        .send({
          duration_minutes: 45,
          total_marks: 50,
          question_count: 10,
          quiz_type: 'QUIZ',
          preferred_date: '2026-06-01',
          preferred_time: '09:00',
        })
        .expect(200);
    });

    it('submission fails with 403 once the faculty\'s assignment has been ended', async () => {
      const assignment = await prisma.facultySubjectBatchAssignment.findFirstOrThrow({
        where: { facultyId: facultyAId, subjectId: dbmsSubjectId, batchId: batchAId },
      });
      await request(app.getHttpServer())
        .delete(`/faculty-assignments/${assignment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/quizzes/${secondQuizId}/submit`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(403);
    });
  });
});
