import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Attendance (e2e) — Phase 17', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string; // quiz owner — never made an invigilator, used for negative auth checks
  let invigilatorToken: string; // the assigned invigilator-of-record for the room

  const adminEmail = 'e2e-p17-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P17-${suffix}`;
  const progCode = `BTCSE-P17-${suffix}`;
  const building = `Bldg-P17-${suffix}`;

  let departmentId: string;
  let programId: string;
  let dbmsSubjectId: string;
  let facultyAId: string; // quiz owner
  let facultyBId: string; // invigilator-of-record

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

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
    await request(app.getHttpServer())
      .post('/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Faculty C', email: `facultyC-${suffix}@test.local`, department_id: departmentId, employee_code: `FACC-${suffix}` })
      .expect(201);

    for (const [userEmail, setter] of [
      [`facultyA-${suffix}@test.local`, (t: string) => (facultyToken = t)],
      [`facultyB-${suffix}@test.local`, (t: string) => (invigilatorToken = t)],
      [`facultyC-${suffix}@test.local`, (_t: string) => undefined],
    ] as const) {
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
      await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash } });
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: userEmail, password }).expect(200);
      setter(login.body.access_token);
    }
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.attendanceHistory.deleteMany({ where: { attendance: { quizStudentAssignment: { examSession: { createdByAdminId: adminUser?.id } } } } });
    await prisma.attendance.deleteMany({ where: { quizStudentAssignment: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: (await prisma.user.findMany({ where: { email: { in: [`facultyA-${suffix}@test.local`, `facultyB-${suffix}@test.local`, `facultyC-${suffix}@test.local`] } }, select: { id: true } })).map((u) => u.id) } } });
    await prisma.examInvigilator.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.seatingAssignment.deleteMany({ where: { seatingPlan: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.seatingPlan.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
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
    const testEmails = [adminEmail, `facultyA-${suffix}@test.local`, `facultyB-${suffix}@test.local`, `facultyC-${suffix}@test.local`];
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
    const batch = await prisma.batch.create({ data: { programId, year: '2026', section: `P17-${Date.now()}-${Math.random()}`, subsection: `P17-${Date.now()}-${Math.random()}` } });
    await request(app.getHttpServer())
      .post('/faculty-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ faculty_id: facultyAId, subject_id: dbmsSubjectId, batch_id: batch.id, academic_year: '2026', semester: 1, role: 'PRIMARY_INSTRUCTOR' })
      .expect(201);
    return batch.id as string;
  }

  let studentCounter = 0;
  async function createEnrolledStudent(batchId: string) {
    studentCounter += 1;
    const email = `student-${suffix}-${studentCounter}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Student ${suffix}-${studentCounter}`, email, program_id: programId, batch_id: batchId, roll_number: `ROLL-${suffix}-${studentCounter}` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ student_id: res.body.id, subject_id: dbmsSubjectId, batch_id: batchId, academic_year: '2026', semester: 1 })
      .expect(201);
    return { id: res.body.id as string, email };
  }

  async function loginAsStudent(email: string) {
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200)).body.access_token as string;
  }

  let quizCounter = 0;
  async function createApprovedQuiz(batchId: string) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({
        title: `P17 Quiz ${suffix}-${quizCounter}`,
        subject_id: dbmsSubjectId,
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
    return approved.body.id as string;
  }

  let roomCounter = 0;
  async function createRoom(capacity = 10) {
    roomCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building, floor: 1, room_number: `R${roomCounter}`, capacity, rows: 2, columns: Math.ceil(capacity / 2) })
      .expect(201);
    return res.body.id as string;
  }

  let sessionDayCounter = 0;
  /** Builds a session all the way to a FINALIZED, single-room seating plan with N enrolled/assigned/seated students — everything needed just short of `start`. */
  async function buildFinalizedSession(studentCount: number) {
    sessionDayCounter += 1;
    const sessionDate = `2026-10-${String(sessionDayCounter).padStart(2, '0')}`;
    const batchId = await createIsolatedBatch();
    const quizId = await createApprovedQuiz(batchId);
    const students = await Promise.all(Array.from({ length: studentCount }, () => createEnrolledStudent(batchId)));

    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `P17 Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: '10:00', end_time: '11:00' })
      .expect(201);
    const sessionId = session.body.id as string;

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

    const roomId = await createRoom();
    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/rooms/allocate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_ids: [roomId] })
      .expect(201);

    const gen = await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/seating/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_id: roomId, strategy: 'SEQUENTIAL' })
      .expect(202);

    await request(app.getHttpServer())
      .post(`/seating-plans/${gen.body.seating_plan_id}/finalize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/invigilators`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
      .expect(201);

    return { sessionId, roomId, quizId, students };
  }

  async function buildInProgressSession(studentCount: number) {
    const built = await buildFinalizedSession(studentCount);
    await request(app.getHttpServer())
      .post(`/exam-sessions/${built.sessionId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    return built;
  }

  describe('POST /exam-sessions/{id}/start — the Phase 17 prerequisite plumbing', () => {
    it('rejects a session not yet READY_FOR_FINALIZATION', async () => {
      const session = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Draft ${suffix}-${Date.now()}`, session_date: '2026-11-01', start_time: '10:00', end_time: '11:00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${session.body.id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('rejects non-ADMIN callers', async () => {
      const { sessionId } = await buildFinalizedSession(1);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(403);
    });

    it('starts the session (READY_FOR_FINALIZATION -> IN_PROGRESS) once seating is FINALIZED', async () => {
      const { sessionId } = await buildFinalizedSession(1);
      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(res.body.status).toBe('IN_PROGRESS');
    });
  });

  describe('POST /exam-sessions/{id}/attendance — BR-032/033/036, FR-037', () => {
    it('rejects unauthenticated / non-FACULTY callers', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(403); // POST is FACULTY-only, no ADMIN override (API_CONTRACT.md's literal actor set)
    });

    it('403s a faculty who is NOT the invigilator-of-record for the student\'s room', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${facultyToken}`) // Faculty A — quiz owner, NOT an invigilator here
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(403);
    });

    it('422s when the session is not IN_PROGRESS (BR-032)', async () => {
      const { sessionId, students } = await buildFinalizedSession(1); // never started
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(422);
    });

    it('marks attendance and 409s a duplicate mark for the same student (BR-033/EC-027)', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      const res = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);
      expect(res.body.status).toBe('PRESENT');
      expect(res.body.locked).toBe(false);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'ABSENT', method: 'MANUAL' })
        .expect(409);
    });

    it('rejects marking for a CANCELLED session (BR-036)', async () => {
      const { sessionId, students } = await buildFinalizedSession(1);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'test' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(409);
    });

    it('EC-042: concurrent marks for DIFFERENT students in the same session all succeed independently', async () => {
      const { sessionId, students } = await buildInProgressSession(3);

      const results = await Promise.all(
        students.map((s) =>
          request(app.getHttpServer())
            .post(`/exam-sessions/${sessionId}/attendance`)
            .set('Authorization', `Bearer ${invigilatorToken}`)
            .send({ student_id: s.id, status: 'PRESENT', method: 'SEAT_BASED' }),
        ),
      );

      expect(results.every((r) => r.status === 201)).toBe(true);
      const rows = await prisma.attendance.findMany({
        where: { quizStudentAssignment: { examSessionId: sessionId } },
      });
      expect(rows).toHaveLength(3);
    });
  });

  describe('PATCH /attendance/{id} — BR-035, EC-028 (post-lock reason required, 423)', () => {
    it('rejects unauthenticated / STUDENT callers', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      const marked = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      await request(app.getHttpServer()).patch(`/attendance/${marked.body.id}`).send({ status: 'ABSENT' }).expect(401);

      const studentToken = await loginAsStudent(students[0].email);
      await request(app.getHttpServer())
        .patch(`/attendance/${marked.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ status: 'ABSENT' })
        .expect(403);
    });

    it('403s a faculty who is not the invigilator-of-record', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      const marked = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/attendance/${marked.body.id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ status: 'ABSENT' })
        .expect(403);
    });

    it('allows a pre-lock change by the invigilator-of-record, no reason required', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      const marked = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/attendance/${marked.body.id}`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ status: 'LATE' })
        .expect(200);
      expect(res.body.status).toBe('LATE');
    });

    it('423s a post-lock change without a reason, then succeeds with one (EC-028)', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      const marked = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/attendance/${marked.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ABSENT' })
        .expect(423);

      const res = await request(app.getHttpServer())
        .patch(`/attendance/${marked.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ABSENT', reason: 'Corrected after review of sign-in sheet' })
        .expect(200);
      expect(res.body.status).toBe('ABSENT');

      const history = await prisma.attendanceHistory.findMany({ where: { attendanceId: marked.body.id } });
      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe('Corrected after review of sign-in sheet');
    });
  });

  describe('POST /exam-sessions/{id}/complete — BR-034 auto-lock', () => {
    it('locks every attendance row in the session on completion', async () => {
      const { sessionId, students } = await buildInProgressSession(2);
      for (const s of students) {
        await request(app.getHttpServer())
          .post(`/exam-sessions/${sessionId}/attendance`)
          .set('Authorization', `Bearer ${invigilatorToken}`)
          .send({ student_id: s.id, status: 'PRESENT', method: 'SEAT_BASED' })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const rows = await prisma.attendance.findMany({ where: { quizStudentAssignment: { examSessionId: sessionId } } });
      expect(rows.every((r) => r.locked)).toBe(true);
    });
  });

  describe('GET /exam-sessions/{id}/attendance — ADMIN all, FACULTY own room only', () => {
    it('ADMIN sees all rows; a non-invigilating faculty sees an empty page', async () => {
      const { sessionId, students } = await buildInProgressSession(1);
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      const asAdmin = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(asAdmin.body.items.length).toBeGreaterThanOrEqual(1);

      const facultyCLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `facultyC-${suffix}@test.local`, password })
        .expect(200);
      const asUninvolvedFaculty = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${facultyCLogin.body.access_token}`)
        .expect(200);
      expect(asUninvolvedFaculty.body.items).toEqual([]);

      const asInvigilator = await request(app.getHttpServer())
        .get(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(200);
      expect(asInvigilator.body.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /students/{id}/attendance-history — self/ADMIN', () => {
    it('a student can view their OWN attendance history; a different student cannot (404, BR-045-style)', async () => {
      const { sessionId, students } = await buildInProgressSession(2);
      const marked = await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/attendance`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ student_id: students[0].id, status: 'PRESENT', method: 'SEAT_BASED' })
        .expect(201);

      const student0Token = await loginAsStudent(students[0].email);
      const own = await request(app.getHttpServer())
        .get(`/students/${students[0].id}/attendance-history`)
        .set('Authorization', `Bearer ${student0Token}`)
        .expect(200);
      expect(own.body.items.some((a: any) => a.id === marked.body.id)).toBe(true);

      const student1Token = await loginAsStudent(students[1].email);
      await request(app.getHttpServer())
        .get(`/students/${students[0].id}/attendance-history`)
        .set('Authorization', `Bearer ${student1Token}`)
        .expect(404);
    });
  });
});
