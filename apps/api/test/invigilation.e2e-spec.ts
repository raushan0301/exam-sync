import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Invigilation (e2e) — Phase 16', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string; // the quiz-owning instructor — used to create/submit quizzes
  let invigilatorToken: string; // Faculty B — the one actually assigned as invigilator in most tests

  const adminEmail = 'e2e-p16-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P16-${suffix}`;
  const progCode = `BTCSE-P16-${suffix}`;
  const building = `Bldg-P16-${suffix}`;

  let departmentId: string;
  let programId: string;
  let dbmsSubjectId: string;
  let facultyAId: string; // quiz owner
  let facultyBId: string; // invigilator-under-test
  let facultyBUserId: string;

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
      [`facultyA-${suffix}@test.local`, (t: string) => (facultyToken = t)],
      [`facultyB-${suffix}@test.local`, (t: string) => (invigilatorToken = t)],
    ] as const) {
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password })
        .expect(200);
      setter(login.body.access_token);
    }
    facultyBUserId = (await prisma.user.findUniqueOrThrow({ where: { email: `facultyB-${suffix}@test.local` } })).id;
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.notification.deleteMany({ where: { recipientId: facultyBUserId } });
    await prisma.examInvigilator.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.examSessionRoomQuiz.deleteMany({ where: { examSessionRoom: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.examSessionRoom.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
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
    await prisma.roomAvailability.deleteMany({ where: { room: { building } } });
    await prisma.roomSeat.deleteMany({ where: { room: { building } } });
    await prisma.room.deleteMany({ where: { building } });
    await prisma.subject.deleteMany({ where: { code: `DBMS-${suffix}` } });
    await prisma.batch.deleteMany({ where: { program: { code: progCode } } });
    await prisma.program.deleteMany({ where: { code: progCode } });
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  async function createIsolatedBatch() {
    const batch = await prisma.batch.create({ data: { programId, year: 2026, section: `P16-${Date.now()}-${Math.random()}` } });
    await request(app.getHttpServer())
      .post('/faculty-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batch.id, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
      .expect(201);
    return batch.id as string;
  }

  let studentCounter = 0;
  async function createEnrolledStudents(count: number, batchId: string) {
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
        .send({ student_id: res.body.id, subject_id: dbmsSubjectId, batch_id: batchId, academic_year: '2026', semester: 1 })
        .expect(201);
      ids.push(res.body.id);
    }
    return ids;
  }

  let quizCounter = 0;
  async function createApprovedQuiz(batchId: string) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({ title: `P16 Quiz ${suffix}-${quizCounter}`, subject_id: dbmsSubjectId, batch_ids: [batchId], academic_year: '2026', semester: 1 })
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

  let roomCounter = 0;
  async function createRoom(capacity = 20) {
    roomCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building, floor: 1, room_number: `R${roomCounter}`, capacity, rows: 5, columns: Math.ceil(capacity / 5) + 2 })
      .expect(201);
    return res.body.id as string;
  }

  let sessionDayCounter = 0;
  /**
   * Builds a full session all the way through room allocation (Phase 12's
   * own dependency), returning ids needed for invigilator assignment.
   * Defaults each call to its OWN fresh `session_date` (so unrelated tests
   * never accidentally collide/overlap) — pass `session_date` explicitly
   * when a test needs two sessions to share the same date on purpose (the
   * Conflict Engine's overlap check requires an exact `sessionDate` match
   * AND overlapping times, same as every other overlap check in this
   * codebase).
   */
  async function buildSessionWithAllocatedRoom(
    overrides: { start_time?: string; end_time?: string; session_date?: string } = {},
  ) {
    sessionDayCounter += 1;
    const sessionDate = overrides.session_date ?? `2026-08-${String(sessionDayCounter).padStart(2, '0')}`;
    const startTime = overrides.start_time ?? '10:00';
    const endTime = overrides.end_time ?? '11:00';

    const batchId = await createIsolatedBatch();
    const quiz = await createApprovedQuiz(batchId);
    await createEnrolledStudents(3, batchId);

    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `P16 Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: startTime, end_time: endTime })
      .expect(201);
    const sessionId = session.body.id as string;

    await request(app.getHttpServer())
      .patch(`/exam-sessions/${sessionId}/quizzes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ add: [quiz.id], remove: [] })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/assign-students`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send()
      .expect(202);

    const roomId = await createRoom();
    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/rooms/allocate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_ids: [roomId] })
      .expect(201);

    return { sessionId, roomId };
  }

  describe('POST /exam-sessions/{id}/invigilators — authorization', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(401);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(403);
    });

    it('422s (validation) for an invalid role value', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'NOT_A_REAL_ROLE' })
        .expect(400);
    });

    it('404s for a faculty id that does not exist', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: '00000000-0000-0000-0000-000000000000', role: 'LEAD_INVIGILATOR' })
        .expect(404);
    });

    it('404s for a room not allocated to this session', async () => {
      const { sessionId } = await buildSessionWithAllocatedRoom();
      const unallocatedRoom = await createRoom();

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: unallocatedRoom, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(404);
    });
  });

  describe('POST /exam-sessions/{id}/invigilators — BR-030 (any subject), FR-035, BR-031 overlap', () => {
    it('assigns a faculty who does NOT teach the subject at all (BR-030)', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      expect(res.body.facultyId ?? res.body.faculty_id).toBe(facultyBId);
      expect(res.body.role).toBe('LEAD_INVIGILATOR');
    });

    it('409s on an exact duplicate (same session, room, faculty) — idempotency-of-input check', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'ASSISTANT_INVIGILATOR' })
        .expect(409);
    });

    it('allows a DIFFERENT faculty invigilating the SAME room/session (multiple invigilators per room)', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyAId, role: 'ASSISTANT_INVIGILATOR' })
        .expect(201);
    });

    it('BR-031: 409s assigning the SAME faculty to a DIFFERENT room whose session overlaps in time', async () => {
      // A fixed calendar date shared by both sessions below — safe to hardcode
      // even though this file runs alongside other e2e specs, since the
      // FACULTY_OVERLAP check is scoped to `facultyBId`, a fresh UUID never
      // used outside this file.
      const sharedDate = '2026-09-01';
      const first = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '09:00', end_time: '10:30' });
      await request(app.getHttpServer())
        .post(`/exam-sessions/${first.sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: first.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      const second = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '10:00', end_time: '11:30' });

      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${second.sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: second.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(409);

      expect(res.body.message).toBeDefined();
    });

    it('allows the SAME faculty to invigilate two DIFFERENT rooms whose sessions do NOT overlap in time (same date, touching times — EC-001)', async () => {
      const sharedDate = '2026-09-02';
      const first = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '09:00', end_time: '10:00' });
      await request(app.getHttpServer())
        .post(`/exam-sessions/${first.sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: first.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      const second = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '10:00', end_time: '11:00' }); // touching, not overlapping

      await request(app.getHttpServer())
        .post(`/exam-sessions/${second.sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: second.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);
    });

    it('rejects assigning to a CANCELLED session', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test cancellation' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(409);
    });
  });

  describe('GET /faculty/{id}/invigilation-duties — self/ADMIN', () => {
    it('rejects unauthenticated callers', async () => {
      await request(app.getHttpServer()).get(`/faculty/${facultyBId}/invigilation-duties`).expect(401);
    });

    it('ADMIN can view any faculty\'s duties', async () => {
      const { sessionId, roomId } = await buildSessionWithAllocatedRoom();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/invigilators`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/faculty/${facultyBId}/invigilation-duties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.some((d: any) => (d.roomId ?? d.room_id) === roomId)).toBe(true);
    });

    it('a faculty can view their OWN duties', async () => {
      const res = await request(app.getHttpServer())
        .get(`/faculty/${facultyBId}/invigilation-duties`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(200);

      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('404s (not 403) when a faculty requests a DIFFERENT faculty\'s duties — BR-045-style IDOR posture', async () => {
      await request(app.getHttpServer())
        .get(`/faculty/${facultyAId}/invigilation-duties`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(404);
    });
  });

  describe('concurrency — two concurrent requests racing to assign the SAME faculty to overlapping rooms', () => {
    it('exactly one of two concurrent overlapping-assignment requests succeeds', async () => {
      const sharedDate = '2026-09-03';
      const first = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '09:00', end_time: '10:30' });
      const second = await buildSessionWithAllocatedRoom({ session_date: sharedDate, start_time: '09:30', end_time: '11:00' });

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/exam-sessions/${first.sessionId}/invigilators`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ room_id: first.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' }),
        request(app.getHttpServer())
          .post(`/exam-sessions/${second.sessionId}/invigilators`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ room_id: second.roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prisma.examInvigilator.findMany({ where: { facultyId: facultyBId } });
      const overlappingRows = rows.filter((r) => [first.roomId, second.roomId].includes(r.roomId));
      expect(overlappingRows).toHaveLength(1);
    });
  });
});
