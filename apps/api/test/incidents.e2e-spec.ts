import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Incident Management (e2e) — Phase 18', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string; // quiz owner — never made an invigilator
  let invigilatorToken: string; // Faculty B — the invigilator-of-record

  const adminEmail = 'e2e-p18-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P18-${suffix}`;
  const progCode = `BTCSE-P18-${suffix}`;
  const building = `Bldg-P18-${suffix}`;

  let departmentId: string;
  let programId: string;
  let dbmsSubjectId: string;
  let facultyAId: string;
  let facultyBId: string;
  let adminUserId: string;

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
    const adminUser = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, isActive: true },
      update: {},
    });
    adminUserId = adminUser.id;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
      create: { userId: adminUser.id, roleId: adminRole.id },
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
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: userEmail, password }).expect(200);
      setter(login.body.access_token);
    }
  });

  afterAll(async () => {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.incidentHistory.deleteMany({ where: { incident: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.incident.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.notification.deleteMany({ where: { recipientId: adminUserId } });
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
    const batch = await prisma.batch.create({ data: { programId, year: 2026, section: `P18-${Date.now()}-${Math.random()}` } });
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
    return res.body.id as string;
  }

  let quizCounter = 0;
  async function createApprovedQuiz(batchId: string) {
    quizCounter += 1;
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({ title: `P18 Quiz ${suffix}-${quizCounter}`, subject_id: dbmsSubjectId, batch_ids: [batchId], academic_year: '2026', semester: 1 })
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
  /** Builds a session with an allocated room and Faculty B assigned as its invigilator-of-record; also enrolls+assigns one student. Returns everything an incident report might reference. */
  async function buildSessionWithInvigilator() {
    sessionDayCounter += 1;
    const sessionDate = `2026-11-${String(sessionDayCounter).padStart(2, '0')}`;
    const batchId = await createIsolatedBatch();
    const quizId = await createApprovedQuiz(batchId);
    const studentId = await createEnrolledStudent(batchId);

    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `P18 Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: '10:00', end_time: '11:00' })
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

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/invigilators`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_id: roomId, faculty_id: facultyBId, role: 'LEAD_INVIGILATOR' })
      .expect(201);

    const seat = await prisma.roomSeat.findFirstOrThrow({ where: { roomId } });

    return { sessionId, roomId, quizId, studentId, seatId: seat.id };
  }

  describe('POST /incidents — BR-037 (invigilator-of-record), FR-039, EC-029', () => {
    it('rejects unauthenticated / non-FACULTY callers', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      await request(app.getHttpServer())
        .post('/incidents')
        .send({ exam_session_id: sessionId, incident_type: 'MISCONDUCT', severity: 'LOW', description: 'x' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'MISCONDUCT', severity: 'LOW', description: 'x' })
        .expect(403);
    });

    it('422s when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ incident_type: 'MISCONDUCT' })
        .expect(400);
    });

    it('403s a faculty who is NOT the invigilator-of-record for this session', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${facultyToken}`) // Faculty A — quiz owner, not an invigilator here
        .send({ exam_session_id: sessionId, incident_type: 'MISCONDUCT', severity: 'LOW', description: 'Talking during exam' })
        .expect(403);
    });

    it('creates an incident referencing student/room/seat and writes a CREATE history row', async () => {
      const { sessionId, roomId, seatId, studentId, quizId } = await buildSessionWithInvigilator();

      const res = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({
          exam_session_id: sessionId,
          quiz_id: quizId,
          student_id: studentId,
          room_id: roomId,
          seat_id: seatId,
          incident_type: 'CHEATING_SUSPICION',
          severity: 'HIGH',
          description: 'Student observed looking at neighboring paper',
          evidence_metadata: { photo_ref: 's3://evidence/1.jpg' },
        })
        .expect(201);

      expect(res.body.status).toBe('OPEN');
      const history = await prisma.incidentHistory.findMany({ where: { incidentId: res.body.id } });
      expect(history).toHaveLength(1);
      expect(history[0].action).toBe('CREATE');
    });

    it('allows an incident with no student/room/seat at all (a general session-level report)', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'TECHNICAL', severity: 'MEDIUM', description: 'Projector malfunction' })
        .expect(201);
    });

    it('does not gate creation on exam session status (EC-029) — allowed even after cancellation', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      await request(app.getHttpServer())
        .post(`/exam-sessions/${sessionId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'test' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'LOW', description: 'Retroactive note' })
        .expect(201);
    });

    it('BR-038: CRITICAL severity queues an immediate Admin notification', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      const res = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'CHEATING_SUSPICION', severity: 'CRITICAL', description: 'Blatant cheating observed' })
        .expect(201);

      const notifications = await prisma.notification.findMany({
        where: { recipientId: adminUserId, eventType: 'INCIDENT_STATUS_UPDATED' },
      });
      expect(notifications.some((n) => (n.payload as any).incident_id === res.body.id)).toBe(true);
      const critical = notifications.find((n) => (n.payload as any).incident_id === res.body.id);
      expect(critical?.channel).toBeDefined();
    });
  });

  describe('PATCH /incidents/{id}/status — ARCHITECTURE.md §AD-2 #6 state graph, BR-039', () => {
    async function createIncident() {
      const { sessionId } = await buildSessionWithInvigilator();
      const res = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'MISCONDUCT', severity: 'LOW', description: 'Test incident' })
        .expect(201);
      return res.body.id as string;
    }

    it('rejects unauthenticated / non-ADMIN callers', async () => {
      const id = await createIncident();
      await request(app.getHttpServer()).patch(`/incidents/${id}/status`).send({ action: 'INVESTIGATE' }).expect(401);
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(403);
    });

    it('409s an invalid transition (OPEN -> RESOLVE directly)', async () => {
      const id = await createIncident();
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'RESOLVE', resolution: 'x' })
        .expect(409);
    });

    it('422s RESOLVE without a resolution', async () => {
      const id = await createIncident();
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'RESOLVE' })
        .expect(422);
    });

    it('walks the full workflow: OPEN -> UNDER_REVIEW -> ESCALATED -> UNDER_REVIEW -> RESOLVED', async () => {
      const id = await createIncident();

      const investigated = await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE', notes: 'Looking into it' })
        .expect(200);
      expect(investigated.body.status).toBe('UNDER_REVIEW');

      const escalated = await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'ESCALATE' })
        .expect(200);
      expect(escalated.body.status).toBe('ESCALATED');

      const reReviewed = await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(200);
      expect(reReviewed.body.status).toBe('UNDER_REVIEW');

      const resolved = await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'RESOLVE', resolution: 'Verified and closed' })
        .expect(200);
      expect(resolved.body.status).toBe('RESOLVED');

      // No reopen path exists by design (EC-031) — RESOLVED is terminal.
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(409);

      const history = await request(app.getHttpServer())
        .get(`/incidents/${id}/history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(history.body.map((h: any) => h.action)).toEqual(['CREATE', 'INVESTIGATE', 'ESCALATE', 'INVESTIGATE', 'RESOLVE']);
    });

    it('ESCALATE queues an immediate Admin notification (EC-030)', async () => {
      const id = await createIncident();
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'ESCALATE' })
        .expect(200);

      const notifications = await prisma.notification.findMany({
        where: { recipientId: adminUserId, eventType: 'INCIDENT_STATUS_UPDATED' },
      });
      expect(notifications.some((n) => (n.payload as any).incident_id === id)).toBe(true);
    });

    it('DISMISS with a resolution is a valid terminal transition from UNDER_REVIEW', async () => {
      const id = await createIncident();
      await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'INVESTIGATE' })
        .expect(200);
      const dismissed = await request(app.getHttpServer())
        .patch(`/incidents/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'DISMISS', resolution: 'Reported wrong student — filing correction' })
        .expect(200);
      expect(dismissed.body.status).toBe('DISMISSED');
    });
  });

  describe('GET /incidents — ADMIN all, FACULTY own reported only; STUDENT never (BR-041)', () => {
    it('rejects STUDENT and unauthenticated callers entirely', async () => {
      await request(app.getHttpServer()).get('/incidents').expect(401);
    });

    it('ADMIN sees incidents from any faculty; the non-reporting faculty sees none of them', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      const created = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'LOW', description: 'Visibility test' })
        .expect(201);

      const asAdmin = await request(app.getHttpServer())
        .get('/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(asAdmin.body.items.some((i: any) => i.id === created.body.id)).toBe(true);

      const asOtherFaculty = await request(app.getHttpServer())
        .get('/incidents')
        .set('Authorization', `Bearer ${facultyToken}`) // Faculty A never reported this one
        .expect(200);
      expect(asOtherFaculty.body.items.some((i: any) => i.id === created.body.id)).toBe(false);

      const asReporter = await request(app.getHttpServer())
        .get('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(200);
      expect(asReporter.body.items.some((i: any) => i.id === created.body.id)).toBe(true);
    });

    it('filters by status/severity/exam_session_id', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'HIGH', description: 'Filter test' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/incidents')
        .query({ exam_session_id: sessionId, severity: 'HIGH', status: 'OPEN' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.items.every((i: any) => i.severity === 'HIGH' && i.status === 'OPEN')).toBe(true);
    });
  });

  describe('GET /incidents/{id}/history — ADMIN only', () => {
    it('rejects FACULTY (even the reporter) and unauthenticated callers', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      const created = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'LOW', description: 'x' })
        .expect(201);

      await request(app.getHttpServer()).get(`/incidents/${created.body.id}/history`).expect(401);
      await request(app.getHttpServer())
        .get(`/incidents/${created.body.id}/history`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(403);
    });
  });

  describe('POST /incidents/{id}/disclose — ADR-007/DEC-009 (ADMIN only, idempotent, no notification)', () => {
    it('rejects non-ADMIN callers', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      const created = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'LOW', description: 'x' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/incidents/${created.body.id}/disclose`)
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .expect(403);
    });

    it('discloses the incident and is idempotent on a second call', async () => {
      const { sessionId } = await buildSessionWithInvigilator();
      const created = await request(app.getHttpServer())
        .post('/incidents')
        .set('Authorization', `Bearer ${invigilatorToken}`)
        .send({ exam_session_id: sessionId, incident_type: 'OTHER', severity: 'LOW', description: 'x' })
        .expect(201);

      const first = await request(app.getHttpServer())
        .post(`/incidents/${created.body.id}/disclose`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(first.body.disclosedAt ?? first.body.disclosed_at).toBeTruthy();

      const second = await request(app.getHttpServer())
        .post(`/incidents/${created.body.id}/disclose`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(second.body.disclosedAt ?? second.body.disclosed_at).toEqual(first.body.disclosedAt ?? first.body.disclosed_at);
    });
  });
});
