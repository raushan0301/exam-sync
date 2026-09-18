import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Exam Sessions (e2e) — Phase 8', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminEmail = 'e2e-p8-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P8-${suffix}`;
  const progCode = `BTCSE-P8-${suffix}`;

  let departmentId: string;
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
    const batchA = await prisma.batch.create({ data: { programId: prog.id, year: 2026, section: 'A' } });
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
  });

  afterAll(async () => {
    await prisma.examSessionQuiz.deleteMany({ where: { quiz: { subjectId: dbmsSubjectId } } });
    await prisma.examSession.deleteMany({ where: { createdByAdminId: (await prisma.user.findUnique({ where: { email: adminEmail } }))?.id } });
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: dbmsSubjectId } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`, `facultyB-${suffix}@test.local`];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.subject.deleteMany({ where: { code: `DBMS-${suffix}` } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  let quizCounter = 0;
  async function createApprovedQuiz() {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyAToken}`)
      .send({ title: `P8 Quiz ${suffix}-${quizCounter}`, subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/quizzes/${created.body.id}`)
      .set('Authorization', `Bearer ${facultyAToken}`)
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
      .set('Authorization', `Bearer ${facultyAToken}`)
      .expect(201);

    const approved = await request(app.getHttpServer())
      .post(`/quizzes/${submitted.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', String(submitted.body.version))
      .expect(201);

    return approved.body as { id: string; version: number };
  }

  async function createDraftQuiz() {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyAToken}`)
      .send({ title: `P8 Draft Quiz ${suffix}-${quizCounter}`, subject_id: dbmsSubjectId, batch_ids: [batchAId], academic_year: '2026', semester: 1 })
      .expect(201);
    return created.body as { id: string };
  }

  async function createSession(overrides: Partial<{ name: string; session_date: string; start_time: string; end_time: string }> = {}) {
    const res = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Session ${suffix}-${Date.now()}`,
        session_date: '2026-05-01',
        start_time: '10:00',
        end_time: '11:00',
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string; status: string; version: number };
  }

  describe('POST /exam-sessions — ADMIN-only (BR-016)', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      await request(app.getHttpServer())
        .post('/exam-sessions')
        .send({ name: 'X', session_date: '2026-05-01', start_time: '10:00', end_time: '11:00' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ name: 'X', session_date: '2026-05-01', start_time: '10:00', end_time: '11:00' })
        .expect(403);
    });

    it('creates a DRAFT session', async () => {
      const session = await createSession();
      expect(session.status).toBe('DRAFT');
      expect(session.version).toBe(1);
    });
  });

  describe('GET /exam-sessions/:id — scoped access', () => {
    it('lets ADMIN view any session', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('blocks an unrelated faculty (no attached quiz) with 404, not 403', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });

    it('lets a faculty who owns an actively-attached quiz view the session', async () => {
      const session = await createSession();
      const quiz = await createApprovedQuiz();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
    });

    it('404s for a non-existent session', async () => {
      await request(app.getHttpServer())
        .get('/exam-sessions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /exam-sessions/:id/quizzes — BR-011/017 (approved-only) and BR-053 (single active session)', () => {
    it('rejects attaching a DRAFT (non-approved) quiz — 409 with structured details', async () => {
      const session = await createSession();
      const draftQuiz = await createDraftQuiz();

      const res = await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [draftQuiz.id], remove: [] })
        .expect(409);

      expect(res.body.details).toEqual([
        expect.objectContaining({ type: 'UNAPPROVED_QUIZ', quizId: draftQuiz.id }),
      ]);
    });

    it('collects multiple hard conflicts in one 409 rather than failing fast', async () => {
      const session = await createSession();
      const draftQuiz = await createDraftQuiz();
      const approvedQuizElsewhere = await createApprovedQuiz();
      const otherSession = await createSession();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${otherSession.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [approvedQuizElsewhere.id], remove: [] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [draftQuiz.id, approvedQuizElsewhere.id], remove: [] })
        .expect(409);

      expect(res.body.details).toHaveLength(2);
      expect(res.body.details.map((d: any) => d.type).sort()).toEqual(
        ['QUIZ_ALREADY_ATTACHED_ELSEWHERE', 'UNAPPROVED_QUIZ'].sort(),
      );
    });

    it('attaches an approved quiz successfully', async () => {
      const session = await createSession();
      const quiz = await createApprovedQuiz();

      const res = await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      expect(res.body.version).toBe(2);
    });

    it('BR-053: rejects attaching a quiz already actively attached to a DIFFERENT session', async () => {
      const sessionOne = await createSession();
      const sessionTwo = await createSession();
      const quiz = await createApprovedQuiz();

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionOne.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionTwo.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(409);

      expect(res.body.details).toEqual([
        expect.objectContaining({ type: 'QUIZ_ALREADY_ATTACHED_ELSEWHERE', quizId: quiz.id }),
      ]);
    });

    it('BR-053 concurrency: the DB partial unique index rejects a genuine race — two concurrent attaches of the same quiz to two different sessions, only one wins', async () => {
      const sessionOne = await createSession();
      const sessionTwo = await createSession();
      const quiz = await createApprovedQuiz();

      // App-level pre-check can't observe the other request mid-flight, so
      // fire both requests concurrently to force the DB constraint itself
      // (exam_session_quizzes_quiz_id_active_key, WHERE is_active_attachment)
      // to be the actual arbiter, per ADR-006's required concurrency test.
      const [resOne, resTwo] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/exam-sessions/${sessionOne.id}/quizzes`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ add: [quiz.id], remove: [] }),
        request(app.getHttpServer())
          .patch(`/exam-sessions/${sessionTwo.id}/quizzes`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ add: [quiz.id], remove: [] }),
      ]);

      const statuses = [resOne.status, resTwo.status];
      // Exactly one request may succeed (200); the other must be rejected
      // — either the app-level pre-check catches it (409, if the two
      // requests happen to resolve sequentially in this single process) or,
      // in a genuine race where both pre-checks pass before either commits,
      // the DB's partial unique index rejects the losing INSERT (surfaced
      // as a 500, since a raw constraint violation isn't mapped to a 409
      // here). Either way, never both succeeding.
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);

      const activeAttachments = await prisma.examSessionQuiz.findMany({
        where: { quizId: quiz.id, isActiveAttachment: true },
      });
      expect(activeAttachments).toHaveLength(1);
    });

    it('re-adding an already-actively-attached quiz to the SAME session is an idempotent no-op', async () => {
      const session = await createSession();
      const quiz = await createApprovedQuiz();

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      const before = await prisma.examSessionQuiz.findUniqueOrThrow({
        where: { examSessionId_quizId: { examSessionId: session.id, quizId: quiz.id } },
      });

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      // The idempotent no-op never re-touches the attachment row itself.
      const after = await prisma.examSessionQuiz.findUniqueOrThrow({
        where: { examSessionId_quizId: { examSessionId: session.id, quizId: quiz.id } },
      });
      expect(after.attachedAt).toEqual(before.attachedAt);
    });

    it('detaches a quiz, then allows re-attaching it to a DIFFERENT session (legitimate rescheduling per ADR-006)', async () => {
      const sessionOne = await createSession();
      const sessionTwo = await createSession();
      const quiz = await createApprovedQuiz();

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionOne.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionOne.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [], remove: [quiz.id] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionTwo.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      const active = await prisma.examSessionQuiz.findMany({ where: { quizId: quiz.id, isActiveAttachment: true } });
      expect(active).toHaveLength(1);
      expect(active[0].examSessionId).toBe(sessionTwo.id);
    });

    it('rejects modifying quizzes on a CANCELLED session with 409', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing invalid transition' })
        .expect(201);

      const quiz = await createApprovedQuiz();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(409);
    });
  });

  describe('POST /exam-sessions/:id/reschedule', () => {
    it('reschedules a DRAFT session', async () => {
      const session = await createSession();
      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ session_date: '2026-06-15', start_time: '09:00', end_time: '10:30' })
        .expect(201);

      expect(res.body.version).toBe(2);
    });

    it('rejects rescheduling a CANCELLED session with 409', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing invalid transition' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ session_date: '2026-06-15', start_time: '09:00', end_time: '10:30' })
        .expect(409);
    });
  });

  describe('POST /exam-sessions/:id/cancel — cascades isActiveAttachment=false', () => {
    it('requires a non-empty reason', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '' })
        .expect(400);
    });

    it('cancels a DRAFT session and releases all its active quiz attachments', async () => {
      const session = await createSession();
      const quiz = await createApprovedQuiz();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Room unavailable' })
        .expect(201);

      expect(res.body.status).toBe('CANCELLED');
      const attachment = await prisma.examSessionQuiz.findUniqueOrThrow({
        where: { examSessionId_quizId: { examSessionId: session.id, quizId: quiz.id } },
      });
      expect(attachment.isActiveAttachment).toBe(false);
      expect(attachment.detachedAt).not.toBeNull();

      // The quiz is now free to be attached to a fresh session (BR-053 allows re-scheduling after cancellation).
      const freshSession = await createSession();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${freshSession.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);
    });

    it('rejects cancelling an already-CANCELLED session with 409', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'First cancel' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Second cancel' })
        .expect(409);
    });
  });

  describe('GET /exam-sessions/:id/conflicts — ADMIN dry-run (Conflict Engine STUB always returns empty)', () => {
    it('returns an empty hard/warnings result for the Phase 8 stub', async () => {
      const session = await createSession();
      const quiz = await createApprovedQuiz();
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quiz.id], remove: [] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}/conflicts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toEqual({ hard: [], warnings: [] });
    });

    it('rejects non-ADMIN callers', async () => {
      const session = await createSession();
      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}/conflicts`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(403);
    });
  });
});
