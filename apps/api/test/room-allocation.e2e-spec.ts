import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Room Allocation (e2e) — Phase 12', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p12-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P12-${suffix}`;
  const progCode = `BTCSE-P12-${suffix}`;
  const building = `Bldg-P12-${suffix}`;

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
    await prisma.examSessionRoomQuiz.deleteMany({ where: { examSessionRoom: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.examSessionRoom.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
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
    const batch = await prisma.batch.create({ data: { programId, year: 2026, section: `P12-${Date.now()}-${Math.random()}` } });
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
      .send({ title: `P12 Quiz ${suffix}-${quizCounter}`, subject_id: subjectId, batch_ids: [batchId], academic_year: '2026', semester: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/quizzes/${created.body.id}`)
      .set('Authorization', `Bearer ${facultyToken}`)
      .set('If-Match', String(created.body.version))
      .send({ duration_minutes: 60, total_marks: 100, question_count: 20, quiz_type: 'QUIZ', preferred_date: '2026-05-01', preferred_time: '10:00' })
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
  async function createSessionAssigningStudents(quizIds: string[], overrides: { start_time?: string; end_time?: string } = {}) {
    sessionDayCounter += 1;
    const sessionDate = `2026-06-${String(sessionDayCounter).padStart(2, '0')}`;
    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Session ${suffix}-${Date.now()}-${Math.random()}`,
        session_date: sessionDate,
        start_time: overrides.start_time ?? '10:00',
        end_time: overrides.end_time ?? '11:00',
      })
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

    return { id: session.body.id as string, session_date: sessionDate, start_time: overrides.start_time ?? '10:00', end_time: overrides.end_time ?? '11:00' };
  }

  let roomCounter = 0;
  async function createRoom(capacity: number, rows = 5, columns = Math.ceil(capacity / 5) + 2) {
    roomCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building, floor: 1, room_number: `R${roomCounter}`, capacity, rows, columns })
      .expect(201);
    return res.body as { id: string };
  }

  describe('authorization and preconditions', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(1, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(10);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .send({ room_ids: [room.id] })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ room_ids: [room.id] })
        .expect(403);
    });

    it('rejects allocation on a DRAFT session (not yet ASSIGNING_STUDENTS)', async () => {
      const session = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Draft ${suffix}-${Date.now()}`, session_date: '2026-07-01', start_time: '10:00', end_time: '11:00' })
        .expect(201);
      const room = await createRoom(10);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.body.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);
    });

    it('rejects manual mode with no room_ids (400)', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(1, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('404s for a candidate room that does not exist', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(1, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: ['00000000-0000-0000-0000-000000000000'] })
        .expect(404);
    });
  });

  describe('successful allocation — manual and auto modes, capacity, transition, GET reflects it', () => {
    it('manual mode: allocates the given room and transitions the session to SEATING_GENERATION', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(5, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(20);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(201);

      expect(res.body.status).toBe('SEATING_GENERATION');

      const detail = await request(app.getHttpServer())
        .get(`/exam-sessions/${session.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(detail.body.rooms).toHaveLength(1);
      expect(detail.body.rooms[0].id).toBe(room.id);
      expect(detail.body.rooms[0].allocatedCapacity).toBe(5);

      const row = await prisma.examSessionRoom.findUniqueOrThrow({
        where: { roomId_examSessionId: { roomId: room.id, examSessionId: session.id } },
      });
      expect(row.allocatedCapacity).toBe(5);
    });

    it('auto mode with no candidate_room_ids finds an available room itself', async () => {
      // NOTE: `building` (and therefore the auto-search pool) is shared
      // across this whole file's tests, each on its own session_date, so
      // more than one ACTIVE, unblocked room can legitimately match —
      // assert that auto-mode found SOME sufficient room, not this
      // specific one (a different, correctly-behaving assertion than the
      // manual-mode test above, which pins the exact room on purpose).
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(3, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      await createRoom(20);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ auto: true })
        .expect(201);

      expect(res.body.status).toBe('SEATING_GENERATION');
      const rows = await prisma.examSessionRoom.findMany({ where: { examSessionId: session.id } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.reduce((sum, r) => sum + r.allocatedCapacity, 0)).toBe(3);
    });

    it('re-running allocate on the same session afterward is rejected (idempotency guard)', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(20);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);
    });
  });

  describe('Best-Fit Decreasing across multiple subjects/rooms', () => {
    it('splits a cohort larger than any single room across multiple rooms (EC-005)', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(14, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const roomA = await createRoom(8, 2, 4);
      const roomB = await createRoom(8, 2, 4);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [roomA.id, roomB.id] })
        .expect(201);

      expect(res.body.status).toBe('SEATING_GENERATION');
      const rows = await prisma.examSessionRoom.findMany({ where: { examSessionId: session.id } });
      expect(rows).toHaveLength(2);
      expect(rows.reduce((sum, r) => sum + r.allocatedCapacity, 0)).toBe(14);
    });

    it('BR-023: two different subjects sharing one room are aggregated into a single exam_session_rooms row', async () => {
      const batchId = await createIsolatedBatch();
      const dbmsQuiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      const osQuiz = await createApprovedQuiz(osSubjectId, batchId);
      await createEnrolledStudents(3, dbmsSubjectId, batchId);
      await createEnrolledStudents(2, osSubjectId, batchId);
      const session = await createSessionAssigningStudents([dbmsQuiz.id, osQuiz.id]);
      const room = await createRoom(50);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(201);

      const rows = await prisma.examSessionRoom.findMany({ where: { examSessionId: session.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].allocatedCapacity).toBe(5);
    });
  });

  describe('BR-021 / EC-011 — capacity shortfall aborts all-or-nothing', () => {
    it('rejects with 409 and creates no rows when selected rooms cannot fit all students', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(20, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(5, 1, 5); // only 5 seats for 20 students

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);

      expect(res.body.details[0].message).toContain('Shortfall');
      const rows = await prisma.examSessionRoom.findMany({ where: { examSessionId: session.id } });
      expect(rows).toHaveLength(0);
    });

    it('a disabled seat reduces effective capacity below the room\'s nominal capacity', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(5, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(5, 1, 5);

      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      for (const seat of seats.body) {
        await request(app.getHttpServer())
          .patch(`/rooms/${room.id}/seats/${seat.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false })
          .expect(200);
      }

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409); // 0 active seats now, all 5 students unplaceable
    });
  });

  describe('BR-022 — MAINTENANCE room / blocked availability window cannot be allocated', () => {
    it('rejects a room under MAINTENANCE', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id]);
      const room = await createRoom(20);
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);

      expect(res.body.details).toEqual([expect.objectContaining({ type: 'ROOM_UNAVAILABLE', roomId: room.id })]);
    });

    it('rejects a room with an overlapping room_availability block', async () => {
      const batchId = await createIsolatedBatch();
      const quiz = await createApprovedQuiz(dbmsSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      const session = await createSessionAssigningStudents([quiz.id], { start_time: '10:00', end_time: '11:00' });
      const room = await createRoom(20);
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: session.session_date, start_time: '09:30', end_time: '10:30', reason: 'MAINTENANCE' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.id}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);
    });
  });

  describe('BR-018 — room double-booking (app-level check + DB exclusion constraint)', () => {
    it('rejects allocating a room already allocated to a DIFFERENT overlapping session', async () => {
      const batchId = await createIsolatedBatch();
      const quizA = await createApprovedQuiz(dbmsSubjectId, batchId);
      const quizB = await createApprovedQuiz(osSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      await createEnrolledStudents(2, osSubjectId, batchId);
      const room = await createRoom(20);

      sessionDayCounter += 1;
      const sharedDate = `2026-06-${String(sessionDayCounter).padStart(2, '0')}`;

      async function createAndAssign(quizId: string, startTime: string, endTime: string) {
        const s = await request(app.getHttpServer())
          .post('/exam-sessions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `S ${suffix}-${Date.now()}-${Math.random()}`, session_date: sharedDate, start_time: startTime, end_time: endTime })
          .expect(201);
        await request(app.getHttpServer())
          .patch(`/exam-sessions/${s.body.id}/quizzes`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ add: [quizId], remove: [] })
          .expect(200);
        await request(app.getHttpServer())
          .post(`/exam-sessions/${s.body.id}/assign-students`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send()
          .expect(202);
        return s.body.id as string;
      }

      const sessionAId = await createAndAssign(quizA.id, '10:00', '11:00');
      const sessionBId = await createAndAssign(quizB.id, '10:30', '11:30'); // overlaps sessionA

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionAId}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionBId}/rooms/allocate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_ids: [room.id] })
        .expect(409);

      expect(res.body.details).toEqual([
        expect.objectContaining({ type: 'ROOM_OVERLAP', roomId: room.id, conflictingExamSessionId: sessionAId }),
      ]);
    });
  });

  describe('concurrency — two sessions racing to allocate the SAME overlapping-time room (SELECT ... FOR UPDATE, ADR-003)', () => {
    it('exactly one allocation wins; the room ends up booked for only one of the two sessions', async () => {
      const batchId = await createIsolatedBatch();
      const quizA = await createApprovedQuiz(dbmsSubjectId, batchId);
      const quizB = await createApprovedQuiz(osSubjectId, batchId);
      await createEnrolledStudents(2, dbmsSubjectId, batchId);
      await createEnrolledStudents(2, osSubjectId, batchId);
      const room = await createRoom(20);

      sessionDayCounter += 1;
      const sharedDate = `2026-06-${String(sessionDayCounter).padStart(2, '0')}`;

      const sessionARes = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `RaceA ${suffix}-${Date.now()}`, session_date: sharedDate, start_time: '10:00', end_time: '11:00' })
        .expect(201);
      const sessionBRes = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `RaceB ${suffix}-${Date.now()}`, session_date: sharedDate, start_time: '10:30', end_time: '11:30' })
        .expect(201);

      for (const [sessionId, quizId] of [[sessionARes.body.id, quizA.id], [sessionBRes.body.id, quizB.id]] as const) {
        await request(app.getHttpServer())
          .patch(`/exam-sessions/${sessionId}/quizzes`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ add: [quizId], remove: [] })
          .expect(200);
        await request(app.getHttpServer())
          .post(`/exam-sessions/${sessionId}/assign-students`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send()
          .expect(202);
      }

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/exam-sessions/${sessionARes.body.id}/rooms/allocate`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ room_ids: [room.id] }),
        request(app.getHttpServer())
          .post(`/exam-sessions/${sessionBRes.body.id}/rooms/allocate`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ room_ids: [room.id] }),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);

      const rows = await prisma.examSessionRoom.findMany({ where: { roomId: room.id } });
      expect(rows).toHaveLength(1);
    }, 30000);
  });
});
