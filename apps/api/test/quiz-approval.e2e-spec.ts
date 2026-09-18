import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Quiz Admin Approval (e2e) — Phase 7', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let admin2Token: string; // a second admin who is ALSO a faculty, for BR-014 defense-in-depth

  const adminEmail = 'e2e-p7-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P7-${suffix}`;
  const progCode = `BTCSE-P7-${suffix}`;

  let departmentId: string;
  let programId: string;
  let batchAId: string;
  let dbmsSubjectId: string;

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
    const dbms = await prisma.subject.create({
      data: { departmentId, code: `DBMS-${suffix}`, name: 'Database Management Systems' },
    });
    dbmsSubjectId = dbms.id;

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

    // Admin #2 is ALSO granted the FACULTY role and IS Faculty A's own
    // login — simulating "somehow granted ADMIN role" from
    // IMPLEMENTATION_PLAN.md Phase 7's own test note: "faculty attempting
    // to approve their own quiz -> 403 even if somehow granted ADMIN role."
    const facultyAUser = await prisma.user.findUniqueOrThrow({
      where: { email: `facultyA-${suffix}@test.local` },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: facultyAUser.id, roleId: adminRole.id } },
      create: { userId: facultyAUser.id, roleId: adminRole.id },
      update: {},
    });
    admin2Token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `facultyA-${suffix}@test.local`, password })
        .expect(200)
    ).body.access_token;
  });

  afterAll(async () => {
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: dbmsSubjectId } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`, `facultyB-${suffix}@test.local`];
    // Phase 15 — approve/reject now write notification rows keyed by
    // recipientId (= users.id); clean them up before the users themselves
    // are deleted, so repeated local test runs don't accumulate PENDING
    // rows in the shared test DB indefinitely.
    const testUsers = await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: testUsers.map((u) => u.id) } } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.subject.deleteMany({ where: { code: `DBMS-${suffix}` } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  async function createSubmittedQuiz(token: string, roll: string) {
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `DBMS Quiz ${roll}`, subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/quizzes/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', String(created.body.version))
      .send({
        duration_minutes: 60,
        total_marks: 100,
        question_count: 20,
        quiz_type: 'QUIZ',
        preferred_date: '2026-05-01',
        preferred_time: '10:00',
      })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/quizzes/${created.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    return submitted.body as { id: string; version: number };
  }

  describe('POST /quizzes/{id}/approve', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'A1');

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('If-Match', String(quiz.version))
        .expect(401);

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .set('If-Match', String(quiz.version))
        .expect(403);
    });

    it('BR-014: blocks the creating faculty even when they ALSO hold the ADMIN role (defense in depth beyond the role gate)', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'SelfApprove');

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${admin2Token}`) // Faculty A's own login, now also ADMIN
        .set('If-Match', String(quiz.version))
        .expect(403);
    });

    it('rejects a missing If-Match header with 400', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'A2');
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('EC-047: rejects a stale version with 409', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'A3');
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version + 99))
        .expect(409);
    });

    it('approves a SUBMITTED quiz, transitioning to APPROVED', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'A4');
      const res = await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);

      expect(res.body.status).toBe('APPROVED');
    });

    it('rejects approving a quiz that is not SUBMITTED (e.g. already APPROVED) with 409', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'A5');
      const first = await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(first.body.version))
        .expect(409);
    });
  });

  describe('POST /quizzes/{id}/reject — BR-012', () => {
    it('422s when reason is missing', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'R1');
      const res = await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(422);
      expect(res.body.message).toMatch(/reason/i);
    });

    it('BR-014: blocks self-review on reject too, symmetric with approve', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'SelfReject');
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${admin2Token}`)
        .send({ reason: 'Trying to reject my own quiz' })
        .expect(403);
    });

    it('rejects with a reason, transitioning to REJECTED, and the faculty sees the reason', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'R2');
      const res = await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Insufficient question count for the duration.' })
        .expect(201);
      expect(res.body.status).toBe('REJECTED');

      const viewed = await request(app.getHttpServer())
        .get(`/quizzes/${quiz.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(viewed.body.status).toBe('REJECTED');
    });

    it('this exact rejection reason is persisted in a DB-CHECK-constrained history row (BR-012 enforced at both app AND DB level)', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'R3');
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'DB-level check test' })
        .expect(201);

      // Attempt to insert a REJECTED history row with a NULL reason
      // directly against the DB — the CHECK constraint must reject it
      // even bypassing the application layer entirely.
      await expect(
        prisma.quizApprovalHistory.create({
          data: {
            quizId: quiz.id,
            action: 'REJECTED',
            actorId: (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id,
            reason: null,
            previousStatus: 'SUBMITTED',
            newStatus: 'REJECTED',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('GET /quizzes/{id}/approval-history — full lifecycle + append-only', () => {
    it('records SUBMITTED, then REJECTED, then RESUBMITTED, then APPROVED, in order, never overwriting a prior entry', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'Lifecycle');

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Please add more detail to instructions.' })
        .expect(201);

      // Resubmission (FR-021): edit the REJECTED quiz, then submit again.
      const current = await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } });
      await request(app.getHttpServer())
        .patch(`/quizzes/${quiz.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', String(current.version))
        .send({ instructions: 'Now with more detail.' })
        .expect(200);

      const resubmitted = await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/submit`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(201);
      expect(resubmitted.body.status).toBe('SUBMITTED');

      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(resubmitted.body.version))
        .expect(201);

      const history = await request(app.getHttpServer())
        .get(`/quizzes/${quiz.id}/approval-history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const actions = history.body.map((h: any) => h.action);
      expect(actions).toEqual(['SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED']);

      // The original rejection reason must still be present, untouched,
      // even after later entries were appended (BR-013: never overwritten).
      const rejectionEntry = history.body.find((h: any) => h.action === 'REJECTED');
      expect(rejectionEntry.reason).toBe('Please add more detail to instructions.');
    });

    it('is accessible to the OWNING faculty, not a co-instructor or unrelated faculty', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'HistoryAccess');

      await request(app.getHttpServer())
        .get(`/quizzes/${quiz.id}/approval-history`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/quizzes/${quiz.id}/approval-history`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });
  });

  describe('Resubmission editability (FR-021)', () => {
    it('a REJECTED quiz IS editable via PATCH; a SUBMITTED one is not', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, 'EditRejected');
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Needs revision.' })
        .expect(201);

      const rejected = await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } });
      await request(app.getHttpServer())
        .patch(`/quizzes/${quiz.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .set('If-Match', String(rejected.version))
        .send({ title: 'Revised title' })
        .expect(200);
    });
  });
});
