import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Student Assignment (e2e) — Phase 9', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminEmail = 'e2e-p9-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P9-${suffix}`;
  const progCode = `BTCSE-P9-${suffix}`;

  let departmentId: string;
  let programId: string;
  let batchAId: string;
  let batchBId: string;
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
    const batchB = await prisma.batch.create({ data: { programId, year: 2026, section: 'B' } });
    batchBId = batchB.id;
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
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    // Scoped by the admin's OWN exam sessions (not just this run's quiz
    // subject) so cleanup is robust even if a prior run's `afterAll`
    // never completed (e.g. crashed mid-suite) — an orphaned session from
    // an earlier suffix would otherwise still hold an FK reference and
    // block this run's own deletes.
    await prisma.quizStudentAssignment.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSessionQuiz.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSession.deleteMany({ where: { createdByAdminId: adminUser?.id } });
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: dbmsSubjectId } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.studentSubjectEnrollment.deleteMany({ where: { subjectId: dbmsSubjectId } });
    await prisma.student.deleteMany({ where: { program: { code: progCode } } });
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

  let studentCounter = 0;
  async function createStudent(batchId: string) {
    studentCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Student ${suffix}-${studentCounter}`,
        email: `student-${suffix}-${studentCounter}@test.local`,
        program_id: programId,
        batch_id: batchId,
        roll_number: `ROLL-${suffix}-${studentCounter}`,
      })
      .expect(201);
    return res.body as { id: string };
  }

  async function enrollStudent(studentId: string, batchId: string) {
    await request(app.getHttpServer())
      .post('/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ student_id: studentId, subject_id: dbmsSubjectId, batch_id: batchId, academic_year: '2026', semester: 1 })
      .expect(201);
  }

  let quizCounter = 0;
  async function createApprovedQuiz(batchIds: string[]) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyAToken}`)
      .send({ title: `P9 Quiz ${suffix}-${quizCounter}`, subject_id: dbmsSubjectId, batch_ids: batchIds, academic_year: '2026', semester: 1 })
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

    return approved.body as { id: string };
  }

  let sessionDayCounter = 0;
  async function createSessionWithQuiz(quizId: string) {
    // Phase 10's real Conflict Engine now enforces BR-019 (student
    // overlap) for real — and this file's fixture students/batches are
    // deliberately shared/accumulating across tests (see the roster-GET
    // test's own comment). A distinct calendar day per session keeps
    // every fixture session legitimately non-overlapping regardless of
    // which students end up eligible for it, so this helper's sessions
    // never trip a REAL conflict against each other.
    sessionDayCounter += 1;
    const sessionDate = `2026-05-${String(sessionDayCounter).padStart(2, '0')}`;
    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: '10:00', end_time: '11:00' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/exam-sessions/${session.body.id}/quizzes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ add: [quizId], remove: [] })
      .expect(200);

    return session.body as { id: string; status: string };
  }

  describe('POST /exam-sessions/:id/assign-students — BR-005 eligibility derivation, DRAFT-only, ADMIN-only', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer()).post(`/exam-sessions/${session.id}/assign-students`).expect(401);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(403);
    });

    it('creates ASSIGNED rows only for ENROLLED students; excludes a DROPPED enrollment and an unenrolled-but-same-batch student', async () => {
      const eligible = await createStudent(batchAId);
      await enrollStudent(eligible.id, batchAId);

      const notEnrolled = await createStudent(batchAId);
      // (intentionally never enrolled — batch membership alone must not grant eligibility, BR-005)

      const dropped = await createStudent(batchAId);
      const dropRes = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: dropped.id, subject_id: dbmsSubjectId, batch_id: batchAId, academic_year: '2026', semester: 1 })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/enrollments/${dropRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DROPPED' })
        .expect(200);

      const wrongBatchStudent = await createStudent(batchBId);
      await enrollStudent(wrongBatchStudent.id, batchBId); // enrolled, but the quiz below only targets batch A

      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(202);

      expect(res.body.job_id).toBeDefined();
      expect(res.body.exam_session.status).toBe('ASSIGNING_STUDENTS');

      const rows = await prisma.quizStudentAssignment.findMany({ where: { examSessionId: session.id } });
      const assignedStudentIds = rows.filter((r) => r.status === 'ASSIGNED').map((r) => r.studentId);
      expect(assignedStudentIds).toEqual([eligible.id]);
      expect(assignedStudentIds).not.toContain(notEnrolled.id);
      expect(assignedStudentIds).not.toContain(dropped.id);
      expect(assignedStudentIds).not.toContain(wrongBatchStudent.id);
    });

    it('rejects a session with no attached quizzes', async () => {
      const session = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Empty ${suffix}-${Date.now()}`, session_date: '2026-05-01', start_time: '10:00', end_time: '11:00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.body.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('idempotency/invalid-state: re-running assign-students on the same session after it left DRAFT is rejected with 409', async () => {
      const eligible = await createStudent(batchAId);
      await enrollStudent(eligible.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(202);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      // Still exactly one assignment row — no duplicate created by the rejected second call.
      const rows = await prisma.quizStudentAssignment.findMany({ where: { examSessionId: session.id, quizId: quiz.id, studentId: eligible.id } });
      expect(rows).toHaveLength(1);
    });

    it('rejects assigning students on a CANCELLED session', async () => {
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing invalid transition' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  describe('GET /exam-sessions/:id/roster — scoped access', () => {
    it('lets ADMIN view the roster, including the known eligible student', async () => {
      // A freshly-created batch (not batchAId) keeps this quiz's eligible
      // roster isolated from students enrolled by earlier tests in this
      // same file — batchAId/dbmsSubjectId/academic_year/semester are
      // shared across the whole suite, so eligibility for a batchAId quiz
      // legitimately accumulates every eligible student created so far.
      const isolatedBatch = await prisma.batch.create({ data: { programId, year: 2026, section: `R-${Date.now()}` } });
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          faculty_id: facultyAId,
          subject_id: dbmsSubjectId,
          batch_id: isolatedBatch.id,
          academic_year: '2026',
          semester: 1,
          role: 'PRIMARY_INSTRUCTOR',
        })
        .expect(201);
      const eligible = await createStudent(isolatedBatch.id);
      await enrollStudent(eligible.id, isolatedBatch.id);
      const quiz = await createApprovedQuiz([isolatedBatch.id]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(202);

      const res = await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}/roster`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].studentId).toBe(eligible.id);
    });

    it('lets the owning faculty (Faculty A) view the roster', async () => {
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}/roster`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
    });

    it('blocks an unrelated faculty (Faculty B) with 404', async () => {
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}/roster`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });
  });

  describe('POST /exam-sessions/:id/roster/:studentId — manual add (EC-015)', () => {
    it('rejects an ineligible student (never enrolled) with 409', async () => {
      const ineligible = await createStudent(batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${ineligible.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(409);
    });

    it('404s when the quiz is not actively attached to this session', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const attachedQuiz = await createApprovedQuiz([batchAId]);
      const unattachedQuiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(attachedQuiz.id);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: unattachedQuiz.id })
        .expect(404);
    });

    it('adds an eligible student (late addition / waitlist promotion, EC-015)', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      expect(res.body.status).toBe('ASSIGNED');
    });

    it('is idempotent: adding an already-ASSIGNED student a second time is a no-op', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      const first = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      const rows = await prisma.quizStudentAssignment.findMany({ where: { quizId: quiz.id, studentId: student.id } });
      expect(rows).toHaveLength(1);
    });

    it('rejects a non-ADMIN caller', async () => {
      const student = await createStudent(batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ quiz_id: quiz.id })
        .expect(403);
    });
  });

  describe('DELETE /exam-sessions/:id/roster/:studentId — cancellation (EC-016), never a physical delete', () => {
    it('404s when no assignment exists for this (session, quiz, student)', async () => {
      const student = await createStudent(batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: 'Withdrew' })
        .expect(404);
    });

    it('requires a non-empty reason', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: '' })
        .expect(400);
    });

    it('cancels an ASSIGNED entry, preserves history (row not deleted, status CANCELLED)', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: 'Student withdrew' })
        .expect(200);

      expect(res.body.status).toBe('CANCELLED');
      const row = await prisma.quizStudentAssignment.findUniqueOrThrow({
        where: { quizId_studentId: { quizId: quiz.id, studentId: student.id } },
      });
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelledAt).not.toBeNull();
    });

    it('rejects cancelling an already-CANCELLED assignment with 409', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: 'First cancel' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: 'Second cancel' })
        .expect(409);
    });

    it('after cancellation, the student can be re-added (reactivation, EC-015\'s recovery path)', async () => {
      const student = await createStudent(batchAId);
      await enrollStudent(student.id, batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id, reason: 'Withdrew' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: quiz.id })
        .expect(201);

      expect(res.body.status).toBe('ASSIGNED');
      const rows = await prisma.quizStudentAssignment.findMany({ where: { quizId: quiz.id, studentId: student.id } });
      expect(rows).toHaveLength(1); // reactivated the same row, not a new one
    });

    it('rejects a non-ADMIN caller', async () => {
      const student = await createStudent(batchAId);
      const quiz = await createApprovedQuiz([batchAId]);
      const session = await createSessionWithQuiz(quiz.id);

      await request(app.getHttpServer())
        .delete(`/exam-sessions/${session.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .send({ quiz_id: quiz.id, reason: 'x' })
        .expect(403);
    });
  });
});
