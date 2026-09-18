import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Conflict Engine (e2e) — Phase 10 (real BR-019 student-overlap detection)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const adminEmail = 'e2e-p10-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P10-${suffix}`;
  const progCode = `BTCSE-P10-${suffix}`;

  let departmentId: string;
  let programId: string;
  let batchAId: string;
  let dbmsSubjectId: string;
  let osSubjectId: string;

  let facultyAId: string;
  let facultyAToken: string;

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

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: `facultyA-${suffix}@test.local` } });
    await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `facultyA-${suffix}@test.local`, password })
      .expect(200);
    facultyAToken = login.body.access_token;

    for (const subjectId of [dbmsSubjectId, osSubjectId]) {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          faculty_id: facultyAId,
          subject_id: subjectId,
          batch_id: batchAId,
          academic_year: '2026',
          semester: 1,
          role: 'PRIMARY_INSTRUCTOR',
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.quizStudentAssignment.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSessionQuiz.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSession.deleteMany({ where: { createdByAdminId: adminUser?.id } });
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.studentSubjectEnrollment.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.student.deleteMany({ where: { program: { code: progCode } } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.subject.deleteMany({ where: { code: { in: [`DBMS-${suffix}`, `OS-${suffix}`] } } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  // Every test gets its OWN batch (via `createIsolatedBatch`) rather than
  // sharing `batchAId` — dbmsSubjectId/osSubjectId/academic_year/semester
  // are shared across this whole file, so eligibility (BR-005) would
  // otherwise accumulate every student any EARLIER test enrolled, making
  // later tests' "exactly one conflicting student" assertions false (many
  // unrelated prior-test students would show up as real STUDENT_OVERLAP
  // conflicts too — a real correctness signal from the new engine, not a
  // flake, but not what each test means to isolate).
  async function createIsolatedBatch() {
    const batch = await prisma.batch.create({ data: { programId, year: 2026, section: `P10-${Date.now()}-${Math.random()}` } });
    for (const subjectId of [dbmsSubjectId, osSubjectId]) {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          faculty_id: facultyAId,
          subject_id: subjectId,
          batch_id: batch.id,
          academic_year: '2026',
          semester: 1,
          role: 'PRIMARY_INSTRUCTOR',
        })
        .expect(201);
    }
    return batch.id as string;
  }

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

  async function enrollStudent(studentId: string, subjectId: string, batchId: string) {
    await request(app.getHttpServer())
      .post('/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ student_id: studentId, subject_id: subjectId, batch_id: batchId, academic_year: '2026', semester: 1 })
      .expect(201);
  }

  let quizCounter = 0;
  async function createApprovedQuiz(subjectId: string, batchId: string) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyAToken}`)
      .send({ title: `P10 Quiz ${suffix}-${quizCounter}`, subject_id: subjectId, batch_ids: [batchId], academic_year: '2026', semester: 1 })
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

  async function createSession(overrides: { session_date: string; start_time: string; end_time: string }) {
    const res = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Session ${suffix}-${Date.now()}-${Math.random()}`, ...overrides })
      .expect(201);
    return res.body as { id: string };
  }

  async function attachAndAssign(sessionId: string, quizId: string) {
    await request(app.getHttpServer())
      .patch(`/exam-sessions/${sessionId}/quizzes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ add: [quizId], remove: [] })
      .expect(200);
    return request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/assign-students`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
  }

  describe('real BR-019 detection at assignment time', () => {
    it('BLOCKS a genuinely overlapping session: student already ASSIGNED elsewhere at an intersecting time', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-01', start_time: '10:00', end_time: '11:00' });
      const sessionB = await createSession({ session_date: '2026-06-01', start_time: '10:30', end_time: '11:30' }); // overlaps sessionA

      // Attach BOTH quizzes to their sessions WHILE NEITHER session has any
      // assignment yet — both attaches succeed (attach-time's own eligible-
      // roster check finds nothing to conflict with at this point).
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionA.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [dbmsQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionB.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [osQuiz.id], remove: [] })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionA.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send()
        .expect(202);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionB.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send()
        .expect(202);

      // The overlapping student is skipped (row-level failure), not silently double-assigned.
      expect(res.body.failure_count).toBe(1);
      const rows = await prisma.quizStudentAssignment.findMany({ where: { studentId: student.id, status: 'ASSIGNED' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].examSessionId).toBe(sessionA.id);
    });

    it('ALLOWS the same student in two DIFFERENT, non-overlapping sessions on the same day', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-02', start_time: '10:00', end_time: '11:00' });
      await attachAndAssign(sessionA.id, dbmsQuiz.id).then((r) => expect(r.status).toBe(202));

      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionB = await createSession({ session_date: '2026-06-02', start_time: '14:00', end_time: '15:00' }); // no overlap
      const res = await attachAndAssign(sessionB.id, osQuiz.id);

      expect(res.status).toBe(202);
      expect(res.body.failure_count).toBe(0);
      const rows = await prisma.quizStudentAssignment.findMany({ where: { studentId: student.id, status: 'ASSIGNED' } });
      expect(rows.map((r) => r.examSessionId).sort()).toEqual([sessionA.id, sessionB.id].sort());
    });

    it('ALLOWS back-to-back (touching, not overlapping) sessions — EC-001, no buffer required', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-03', start_time: '10:00', end_time: '11:00' });
      await attachAndAssign(sessionA.id, dbmsQuiz.id).then((r) => expect(r.status).toBe(202));

      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionB = await createSession({ session_date: '2026-06-03', start_time: '11:00', end_time: '12:00' }); // starts exactly when A ends
      const res = await attachAndAssign(sessionB.id, osQuiz.id);

      expect(res.status).toBe(202);
      expect(res.body.failure_count).toBe(0);
    });

    it('ALLOWS overlap against a CANCELLED session — cancellation frees the student (BR-019 excludes CANCELLED)', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-04', start_time: '10:00', end_time: '11:00' });
      await attachAndAssign(sessionA.id, dbmsQuiz.id).then((r) => expect(r.status).toBe(202));
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionA.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Room unavailable' })
        .expect(201);

      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionB = await createSession({ session_date: '2026-06-04', start_time: '10:00', end_time: '11:00' }); // exact same window as the now-cancelled A
      const res = await attachAndAssign(sessionB.id, osQuiz.id);

      expect(res.status).toBe(202);
      expect(res.body.failure_count).toBe(0);
    });

    it('EC-021: reschedule re-runs the real conflict check against the NEW time window and blocks it', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-05', start_time: '10:00', end_time: '11:00' });
      await attachAndAssign(sessionA.id, dbmsQuiz.id).then((r) => expect(r.status).toBe(202));

      // sessionB starts DRAFT, its own time doesn't overlap A yet, so
      // attach succeeds cleanly — it must STAY DRAFT (never call
      // assign-students) for `reschedule` to even be callable.
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionB = await createSession({ session_date: '2026-06-05', start_time: '14:00', end_time: '15:00' });
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionB.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [osQuiz.id], remove: [] })
        .expect(200);

      // Now try to reschedule B into A's window — should be blocked.
      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionB.id}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ session_date: '2026-06-05', start_time: '10:30', end_time: '11:30' })
        .expect(409);

      expect(res.body.details).toEqual([
        expect.objectContaining({ type: 'STUDENT_OVERLAP', studentId: student.id }),
      ]);
    });

    it('BR-019 manual roster add (EC-015) is also blocked by a real overlap', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-06', start_time: '10:00', end_time: '11:00' });
      const sessionB = await createSession({ session_date: '2026-06-06', start_time: '10:30', end_time: '11:30' });

      // Attach both while unassigned (both succeed), THEN assign A only —
      // creating the real conflict AFTER B's attach already went through.
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionA.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [dbmsQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionB.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [osQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionA.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send()
        .expect(202);

      // Manually try to add the now-already-assigned-elsewhere student directly to sessionB's quiz.
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionB.id}/roster/${student.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quiz_id: osQuiz.id })
        .expect(409);
    });
  });

  describe('GET /exam-sessions/:id/conflicts — dry-run, deterministic, never mutates', () => {
    it('reports the same real conflict on repeated calls without creating anything', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      const sessionA = await createSession({ session_date: '2026-06-07', start_time: '10:00', end_time: '11:00' });
      const sessionB = await createSession({ session_date: '2026-06-07', start_time: '10:30', end_time: '11:30' });

      // Attach both while unassigned (both succeed), THEN assign A only —
      // B stays DRAFT-with-osQuiz-attached, so its dry-run can report the
      // conflict that exists NOW, created after B's own attach.
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionA.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [dbmsQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionB.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [osQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionA.id}/assign-students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send()
        .expect(202);

      const [first, second, third] = await Promise.all(
        [1, 2, 3].map(() =>
          request(app.getHttpServer())
            .get(`/exam-sessions/${sessionB.id}/conflicts`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        ),
      );

      for (const res of [first, second, third]) {
        expect(res.body.hard).toEqual([
          expect.objectContaining({ type: 'STUDENT_OVERLAP', studentId: student.id, conflictingExamSessionId: sessionA.id }),
        ]);
      }
      // Read-only — no assignment was ever created for sessionB.
      const rows = await prisma.quizStudentAssignment.findMany({ where: { examSessionId: sessionB.id } });
      expect(rows).toHaveLength(0);
    });
  });

  describe('concurrency — two admins racing to assign the SAME overlapping-eligible student to two different sessions', () => {
    it('exactly one assign-students call wins; the student ends up ASSIGNED in only one session, never both', async () => {
      const batchId = await createIsolatedBatch();
      const student = await createStudent(batchId);
      await enrollStudent(student.id, dbmsSubjectId, batchId);
      await enrollStudent(student.id, osSubjectId, batchId);

      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);

      const sessionA = await createSession({ session_date: '2026-06-08', start_time: '10:00', end_time: '11:00' });
      const sessionB = await createSession({ session_date: '2026-06-08', start_time: '10:30', end_time: '11:30' }); // overlaps A

      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionA.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [dbmsQuiz.id], remove: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${sessionB.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [osQuiz.id], remove: [] })
        .expect(200);

      // Fire both assign-students calls concurrently — neither session has
      // any assignment yet, so a naive check-then-write (without
      // SERIALIZABLE) could let both pass their pre-write check and both
      // commit, producing two overlapping active assignments.
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/exam-sessions/${sessionA.id}/assign-students`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(),
        request(app.getHttpServer())
          .post(`/exam-sessions/${sessionB.id}/assign-students`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(),
      ]);

      // Both calls "succeed" at the HTTP level (202 — the async-job
      // envelope always returns 202), but the per-row outcome inside is
      // what proves the invariant: the student can be a SUCCESS row in at
      // most one of the two jobs.
      expect(resA.status).toBe(202);
      expect(resB.status).toBe(202);
      const successCounts = [resA.body.success_count, resB.body.success_count];

      const activeRows = await prisma.quizStudentAssignment.findMany({
        where: { studentId: student.id, status: 'ASSIGNED' },
      });
      // THE invariant BR-019 exists to guarantee: never two active
      // overlapping assignments for the same student, even under a real
      // concurrent race.
      expect(activeRows).toHaveLength(1);
      // And the job outputs are consistent with that single winner: not
      // both jobs report a successful assignment for this student.
      expect(successCounts.filter((c) => c === 1)).toHaveLength(1);
    }, 30000);
  });
});
