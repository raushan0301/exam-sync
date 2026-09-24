import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Anti-Cheating Seating (e2e) — Phase 14', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p14-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P14-${suffix}`;
  const progCode = `BTCSE-P14-${suffix}`;
  const building = `Bldg-P14-${suffix}`;

  let departmentId: string;
  let programId: string;
  let dbmsSubjectId: string;
  let osSubjectId: string;
  let facultyAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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
    const dbms = await prisma.subject.create({ data: { departmentId, code: `DBMS-${suffix}`, name: 'DBMS' } });
    dbmsSubjectId = dbms.id;
    const os = await prisma.subject.create({ data: { departmentId, code: `OS-${suffix}`, name: 'OS' } });
    osSubjectId = os.id;

    const facultyARes = await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty A', email: `facultyA-${suffix}@test.local`, department_id: departmentId, employee_code: `FACA-${suffix}` })
      .expect(201);
    facultyAId = facultyARes.body.id;

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: `facultyA-${suffix}@test.local` } });
    await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
    facultyToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: `facultyA-${suffix}@test.local`, password }).expect(200)
    ).body.access_token;
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.seatingAssignment.deleteMany({ where: { seatingPlan: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.seatingPlan.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSessionRoomQuiz.deleteMany({ where: { examSessionRoom: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.examSessionRoom.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.quizStudentAssignment.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSessionQuiz.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSession.deleteMany({ where: { createdByAdminId: adminUser?.id } });
    await prisma.quizApprovalHistory.deleteMany({ where: { actorId: adminUser?.id } });
    await prisma.quizApprovalHistory.deleteMany({ where: { quiz: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } } });
    await prisma.quizBatch.deleteMany({ where: { batch: { program: { code: progCode } } } });
    await prisma.quiz.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.studentSubjectEnrollment.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    // Phase 15 — seating finalize fans out SEAT_ASSIGNED notifications to
    // every student's userId; clean those rows up before the students
    // (and their user rows) are deleted, same reasoning as quiz-approval's
    // afterAll.
    const testStudents = await prisma.student.findMany({ where: { program: { code: progCode } }, select: { userId: true } });
    if (testStudents.length > 0) {
      await prisma.notification.deleteMany({ where: { recipientId: { in: testStudents.map((s) => s.userId) } } });
    }
    await prisma.student.deleteMany({ where: { program: { code: progCode } } });
    await prisma.facultySubjectBatchAssignment.deleteMany({ where: { subjectId: { in: [dbmsSubjectId, osSubjectId] } } });
    await prisma.faculty.deleteMany({ where: { department: { code: deptCode } } });
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`];
    const testUsers = await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: testUsers.map((u) => u.id) } } });
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await prisma.roomAvailability.deleteMany({ where: { room: { building } } });
    await prisma.roomSeat.deleteMany({ where: { room: { building } } });
    await prisma.room.deleteMany({ where: { building } });
    await prisma.subject.deleteMany({ where: { code: { in: [`DBMS-${suffix}`, `OS-${suffix}`] } } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  async function createIsolatedBatch() {
    const batch = await prisma.batch.create({ data: { programId, year: '2026', section: `P14-${Date.now()}-${Math.random()}`, subsection: `P14-${Date.now()}-${Math.random()}` } });
    for (const subjectId of [dbmsSubjectId, osSubjectId]) {
      await request(app.getHttpServer())
        .post('/faculty-assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ faculty_id: facultyAId, subject_id: subjectId, batch_id: batch.id, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
        .expect(201);
    }
    return batch.id as string;
  }

  let studentCounter = 0;
  async function createEnrolledStudents(count: number, subjectId: string, batchId: string) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
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
      await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: res.body.id, subject_id: subjectId, batch_id: batchId, academic_year: '2026', semester: 1 })
        .expect(201);
      ids.push(res.body.id);
    }
    return ids;
  }

  let quizCounter = 0;
  async function createApprovedQuiz(subjectId: string, batchId: string) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({
        title: `P14 Quiz ${suffix}-${quizCounter}`,
        subject_id: subjectId,
        batch_ids: [batchId],
        academic_year: '2026',
        semester: 1,
        student_count: 60,
        preferred_date: '2026-05-01',
        preferred_time: '10:00',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/quizzes/${created.body.id}`)
      .set('Authorization', `Bearer ${facultyToken}`)
      .set('If-Match', String(created.body.version))
      .send({ duration_minutes: 60, quiz_type: 'QUIZ' })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/quizzes/${created.body.id}/submit`)
      .set('Authorization', `Bearer ${facultyToken}`)
      .expect(201);

    const approved = await request(app.getHttpServer())
      .post(`/quizzes/${submitted.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', String(submitted.body.version))
      .expect(201);

    return approved.body as { id: string };
  }

  let sessionDayCounter = 0;
  async function createSessionAssigningStudents(quizIds: string[]) {
    sessionDayCounter += 1;
    const sessionDate = `2026-07-${String(sessionDayCounter).padStart(2, '0')}`;
    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: '10:00', end_time: '11:00' })
      .expect(201);

    for (const quizId of quizIds) {
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.body.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quizId], remove: [] })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post(`/exam-sessions/${session.body.id}/assign-students`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send()
      .expect(202);

    return session.body.id as string;
  }

  let roomCounter = 0;
  async function createRoom(capacity: number, rows: number, columns: number) {
    roomCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building, floor: 1, room_number: `R${roomCounter}`, capacity, rows, columns })
      .expect(201);
    return res.body as { id: string };
  }

  async function allocateRoom(sessionId: string, roomId: string) {
    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/rooms/allocate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_ids: [roomId] })
      .expect(201);
  }

  describe('multi-subject room — real greedy graph-coloring + repair', () => {
    it('produces a complete, valid plan with the FR-034 disclaimer, no fallback fired', async () => {
      // Two DIFFERENT batches (one per subject) so a perfect subject
      // alternation is ALSO a perfect batch alternation — otherwise the
      // batch-adjacency soft dimension (validateSeating scores subject,
      // batch, AND quiz independently) would force violations no amount
      // of subject-diversity effort could avoid, which is real, correct
      // behavior, just not what this particular test means to isolate.
      const dbmsBatchId = await createIsolatedBatch();
      const osBatchId = await createIsolatedBatch();
      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, dbmsBatchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, osBatchId);
      await createEnrolledStudents(4, dbmsSubjectId, dbmsBatchId);
      await createEnrolledStudents(4, osSubjectId, osBatchId);
      const sessionId = await createSessionAssigningStudents([dbmsQuiz.id, osQuiz.id]);
      const room = await createRoom(8, 1, 8); // a single row of 8 — deterministic, easy to hand-check adjacency
      await allocateRoom(sessionId, room.id);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      expect(res.body.status).toBe('VALIDATED');
      expect(res.body.disclaimer).toContain('reduce opportunistic copying risk');
      expect(res.body.disclaimer).toContain('not a guarantee');
      expect(res.body.fallback_reason).toBeUndefined();

      const assignments = await prisma.seatingAssignment.findMany({ where: { seatingPlanId: res.body.seating_plan_id } });
      expect(assignments).toHaveLength(8);
      expect(new Set(assignments.map((a) => a.seatId)).size).toBe(8);
      expect(new Set(assignments.map((a) => a.studentId)).size).toBe(8);

      // On an 8-seat line with 4+4, a perfect alternation (0 same-subject adjacencies) is achievable —
      // the algorithm should find it (or something very close, reported via soft_constraint_score).
      expect(res.body.soft_constraint_score).toBeGreaterThanOrEqual(0.8);
    });

    it('EC-009: any remaining same-subject adjacency is reported in soft_violations, never silently hidden', async () => {
      const batchId = await createIsolatedBatch();
      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      // Heavily imbalanced: 7 DBMS vs 1 OS — same-subject adjacency is unavoidable somewhere.
      await createEnrolledStudents(7, dbmsSubjectId, batchId);
      await createEnrolledStudents(1, osSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([dbmsQuiz.id, osQuiz.id]);
      const room = await createRoom(8, 1, 8);
      await allocateRoom(sessionId, room.id);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      expect(res.body.status).toBe('VALIDATED'); // soft violations never block FINALIZE-eligibility
      expect(res.body.soft_violations.length).toBeGreaterThan(0);
      expect(res.body.soft_violations.some((v: any) => v.type === 'SUBJECT_ADJACENCY')).toBe(true);
      expect(res.body.soft_constraint_score).toBeLessThan(1);
    });
  });

  describe('single-subject fallback chain (ARCHITECTURE.md §U step 6, PRD FR-033)', () => {
    it('falls back and reports fallback_reason when the room roster has only one subject', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(6, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(6, 1, 6);
      await allocateRoom(sessionId, room.id);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      expect(res.body.status).toBe('VALIDATED');
      expect(res.body.fallback_reason).toBeDefined();
      expect(res.body.disclaimer).toBeDefined(); // still present even on the fallback path

      const assignments = await prisma.seatingAssignment.findMany({ where: { seatingPlanId: res.body.seating_plan_id } });
      expect(assignments).toHaveLength(6); // still seats everyone — a degraded-effectiveness plan, not a failed one
    });

    it('a persisted fallback notice survives a later GET /seating-jobs/:id read', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(4, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(4, 1, 4);
      await allocateRoom(sessionId, room.id);

      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      const job = await request(app.getHttpServer())
        .get(`/seating-jobs/${gen.body.job_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(job.body.fallback_reason).toBe(gen.body.fallback_reason);
      expect(job.body.disclaimer).toContain('reduce opportunistic copying risk');
    });
  });

  describe('FINALIZE works identically to every other strategy (BR-026/027)', () => {
    it('finalizes a VALIDATED ANTI_CHEATING plan', async () => {
      const batchId = await createIsolatedBatch();
      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      await createEnrolledStudents(2, osSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([dbmsQuiz.id, osQuiz.id]);
      const room = await createRoom(4, 1, 4);
      await allocateRoom(sessionId, room.id);

      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      const finalized = await request(app.getHttpServer())
        .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(finalized.body.status).toBe('FINALIZED');
    });
  });

  describe('EC-010: HARD-infeasible ANTI_CHEATING plan still FAILS cleanly, same as every other strategy', () => {
    it('marks the plan FAILED (never silently finalized) when seats are disabled after allocation', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(6, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(6, 1, 6);
      await allocateRoom(sessionId, room.id);

      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      for (const seat of seats.body.slice(0, 3)) {
        await request(app.getHttpServer())
          .patch(`/rooms/${room.id}/seats/${seat.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.hard_violations.some((v: any) => v.type === 'UNSEATED_STUDENT')).toBe(true);

      await request(app.getHttpServer())
        .post(`/seating-plans/${res.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409); // BR-026 — never silently finalized
    });
  });

  describe('authorization and the existing idempotency guard apply identically to ANTI_CHEATING', () => {
    it('rejects a non-ADMIN caller (same guard as every other strategy)', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(4, 1, 4);
      await allocateRoom(sessionId, room.id);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(403);
    });

    it('EC-032: a second generate call for the same (session, room) returns the existing plan, no duplicate', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(4, 1, 4);
      await allocateRoom(sessionId, room.id);

      const first = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      const second = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ANTI_CHEATING' })
        .expect(202);

      expect(second.body.seating_plan_id).toBe(first.body.seating_plan_id);
      const count = await prisma.seatingAssignment.count({ where: { seatingPlanId: first.body.seating_plan_id } });
      expect(count).toBe(2);
    });
  });
});
