import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Seating Engine (e2e) — Phase 13', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p13-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P13-${suffix}`;
  const progCode = `BTCSE-P13-${suffix}`;
  const building = `Bldg-P13-${suffix}`;

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
    const batch = await prisma.batch.create({ data: { programId, year: '2026', section: `P13-${Date.now()}-${Math.random()}`, subsection: `P13-${Date.now()}-${Math.random()}` } });
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
        title: `P13 Quiz ${suffix}-${quizCounter}`,
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
    const sessionDate = `2026-06-${String(sessionDayCounter).padStart(2, '0')}`;
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

  /** Fixture: one batch, N students all enrolled+assigned to one DBMS quiz, one room with EXACTLY `roomCapacity` real seats (rows=1, columns=roomCapacity — seat count is rows×columns, independent of the `capacity` field), session allocated and in SEATING_GENERATION. */
  async function setupSingleRoomSession(studentCount: number, roomCapacity: number) {
    const batchId = await createIsolatedBatch();
    const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
    await createEnrolledStudents(studentCount, dbmsSubjectId, batchId);
    const sessionId = await createSessionAssigningStudents([quiz.id]);
    const room = await createRoom(roomCapacity, 1, roomCapacity);

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/rooms/allocate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_ids: [room.id] })
      .expect(201);

    return { sessionId, roomId: room.id, quizId: quiz.id };
  }

  describe('POST /exam-sessions/:id/seating/generate — authorization and preconditions', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(3, 10);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(403);
    });

    it('rejects an unknown/invalid strategy value with 400', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(3, 10);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'NOT_A_REAL_STRATEGY' })
        .expect(400);
    });

    // ANTI_CHEATING itself is now a fully-supported strategy — see
    // test/anti-cheating.e2e-spec.ts (Phase 14).

    it('rejects a session not yet in SEATING_GENERATION', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(10, 2, 5);
      // Deliberately do NOT allocate the room — session stays ASSIGNING_STUDENTS.

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'SEQUENTIAL' })
        .expect(409);
    });

    it('404s when the room was never allocated to this session', async () => {
      const { sessionId } = await setupSingleRoomSession(3, 10);
      const unallocatedRoom = await createRoom(10, 2, 5);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: unallocatedRoom.id, strategy: 'SEQUENTIAL' })
        .expect(404);
    });
  });

  describe('successful generation — VALIDATED, correct assignments, session transition, reads', () => {
    it('generates a complete, valid SEQUENTIAL plan and advances the session to READY_FOR_FINALIZATION (single room)', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(6, 10);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      expect(res.body.status).toBe('VALIDATED');
      expect(res.body.hard_violations).toEqual([]);

      const assignments = await prisma.seatingAssignment.findMany({ where: { seatingPlanId: res.body.seating_plan_id } });
      expect(assignments).toHaveLength(6);
      // BR-024/025 — one seat per student, one student per seat.
      expect(new Set(assignments.map((a) => a.seatId)).size).toBe(6);
      expect(new Set(assignments.map((a) => a.studentId)).size).toBe(6);

      const session = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(session.body.status).toBe('READY_FOR_FINALIZATION');
    });

    it('EC-032 idempotency: a second generate call for the same (session, room) returns the SAME existing plan', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(3, 10);

      const first = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      const second = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'RANDOMIZED' }) // even with a DIFFERENT strategy — still short-circuited
        .expect(202);

      expect(second.body.seating_plan_id).toBe(first.body.seating_plan_id);
      const assignmentCount = await prisma.seatingAssignment.count({ where: { seatingPlanId: first.body.seating_plan_id } });
      expect(assignmentCount).toBe(3); // never duplicated
    });

    it('GET /seating-jobs/:id returns the plan status (ADMIN-only)', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(2, 10);
      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      const job = await request(app.getHttpServer())
        .get(`/seating-jobs/${gen.body.job_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(job.body.status).toBe('VALIDATED');

      await request(app.getHttpServer())
        .get(`/seating-jobs/${gen.body.job_id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });

    it('GET /seating-plans/:id — ADMIN and the owning FACULTY can view; an unrelated caller cannot', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(2, 10);
      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      const adminView = await request(app.getHttpServer())
        .get(`/seating-plans/${gen.body.seating_plan_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminView.body.assignments).toHaveLength(2);

      // facultyToken IS Faculty A, who owns the quiz attached to this session — allowed.
      await request(app.getHttpServer())
        .get(`/seating-plans/${gen.body.seating_plan_id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/seating-plans/${gen.body.seating_plan_id}`)
        .expect(401);
    });
  });

  describe('capacity shortfall — FAILED plan, not an HTTP error, session never advances', () => {
    it('marks the plan FAILED when seats are disabled AFTER allocation, dropping below the assigned cohort size', async () => {
      // Phase 12 itself already refuses to ALLOCATE a room with insufficient
      // nominal capacity (BR-021/EC-011) — so a genuine seating-time
      // shortfall can only arise from something changing afterward (seats
      // disabled, EC-048). Allocate with enough capacity, then disable most
      // of the room's seats to force a real shortfall at generation time.
      const { sessionId, roomId } = await setupSingleRoomSession(8, 8);

      const seats = await request(app.getHttpServer())
        .get(`/rooms/${roomId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      for (const seat of seats.body.slice(0, 3)) {
        await request(app.getHttpServer())
          .patch(`/rooms/${roomId}/seats/${seat.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      expect(res.body.status).toBe('FAILED');
      expect(res.body.hard_violations.length).toBeGreaterThan(0);
      expect(res.body.hard_violations.some((v: any) => v.type === 'UNSEATED_STUDENT')).toBe(true);

      const session = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(session.body.status).toBe('SEATING_GENERATION'); // never advanced
    });

    it('a disabled seat is never used, producing the same FAILED outcome even when nominal capacity looked sufficient', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(5, 5); // exactly matches on paper

      const seats = await request(app.getHttpServer())
        .get(`/rooms/${roomId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/rooms/${roomId}/seats/${seats.body[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      expect(res.body.status).toBe('FAILED');
    });
  });

  describe('POST /seating-plans/:id/finalize', () => {
    it('rejects a non-ADMIN caller', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(2, 10);
      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      await request(app.getHttpServer())
        .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });

    it('finalizes a VALIDATED plan; re-finalizing afterward is rejected (already FINALIZED)', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(2, 10);
      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);

      const finalized = await request(app.getHttpServer())
        .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(finalized.body.status).toBe('FINALIZED');

      await request(app.getHttpServer())
        .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('rejects finalizing a FAILED plan with 409 (BR-026)', async () => {
      const { sessionId, roomId } = await setupSingleRoomSession(8, 8);
      const seats = await request(app.getHttpServer())
        .get(`/rooms/${roomId}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      for (const seat of seats.body.slice(0, 3)) {
        await request(app.getHttpServer())
          .patch(`/rooms/${roomId}/seats/${seat.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false })
          .expect(200);
      }

      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
        .expect(202);
      expect(gen.body.status).toBe('FAILED');

      await request(app.getHttpServer())
        .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  describe('multi-room split (EC-005) and multi-subject sharing (BR-023) end-to-end', () => {
    it('splits a cohort larger than any single room across two rooms, each with its own correct seating plan', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(14, dbmsSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([quiz.id]);
      const roomA = await createRoom(8, 2, 4);
      const roomB = await createRoom(8, 2, 4);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [roomA.id, roomB.id] })
        .expect(201);

      const genA = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomA.id, strategy: 'SEQUENTIAL' })
        .expect(202);
      expect(genA.body.status).toBe('VALIDATED');

      // Session should NOT yet be READY_FOR_FINALIZATION — room B has no plan.
      let session = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(session.body.status).toBe('SEATING_GENERATION');

      const genB = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomB.id, strategy: 'SEQUENTIAL' })
        .expect(202);
      expect(genB.body.status).toBe('VALIDATED');

      session = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(session.body.status).toBe('READY_FOR_FINALIZATION');

      // Every one of the 14 students got EXACTLY one seat, across the two plans combined, no overlap.
      const allAssignments = await prisma.seatingAssignment.findMany({
        where: { seatingPlanId: { in: [genA.body.seating_plan_id, genB.body.seating_plan_id] } },
      });
      expect(allAssignments).toHaveLength(14);
      expect(new Set(allAssignments.map((a) => a.studentId)).size).toBe(14);
    });

    it('BR-023: two subjects sharing one room produce one plan seating both cohorts, with no student overlap', async () => {
      const batchId = await createIsolatedBatch();
      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      await createEnrolledStudents(3, dbmsSubjectId, batchId);
      await createEnrolledStudents(2, osSubjectId, batchId);
      const sessionId = await createSessionAssigningStudents([dbmsQuiz.id, osQuiz.id]);
      const room = await createRoom(20, 4, 5);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(201);

      const gen = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: room.id, strategy: 'ALTERNATE_SUBJECT' })
        .expect(202);

      expect(gen.body.status).toBe('VALIDATED');
      const assignments = await prisma.seatingAssignment.findMany({ where: { seatingPlanId: gen.body.seating_plan_id } });
      expect(assignments).toHaveLength(5);
      const quizIds = new Set(assignments.map((a) => a.quizId));
      expect(quizIds).toEqual(new Set([dbmsQuiz.id, osQuiz.id]));
    });
  });

  describe('every Phase 13 strategy produces a valid, complete plan end-to-end', () => {
    const strategies = ['SEQUENTIAL', 'RANDOMIZED', 'ALTERNATE_SUBJECT', 'ALTERNATE_BATCH', 'SUBJECT_BATCH_MIX'];

    it.each(strategies)('%s: every student seated exactly once, every seat used at most once', async (strategy) => {
      const { sessionId, roomId } = await setupSingleRoomSession(6, 10);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/seating/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, strategy })
        .expect(202);

      expect(res.body.status).toBe('VALIDATED');
      const assignments = await prisma.seatingAssignment.findMany({ where: { seatingPlanId: res.body.seating_plan_id } });
      expect(assignments).toHaveLength(6);
      expect(new Set(assignments.map((a) => a.seatId)).size).toBe(6);
      expect(new Set(assignments.map((a) => a.studentId)).size).toBe(6);
    });
  });
});
