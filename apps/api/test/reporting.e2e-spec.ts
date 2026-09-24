import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Reporting (e2e) — Phase 19', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;
  let invigilatorToken: string;
  let adminUserId: string;

  const adminEmail = 'e2e-p19-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P19-${suffix}`;
  const progCode = `BTCSE-P19-${suffix}`;
  const building = `Bldg-P19-${suffix}`;

  let departmentId: string;
  let programId: string;
  let dbmsSubjectId: string;
  let facultyAId: string;
  let facultyBId: string;

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
    await prisma.reportJob.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.notification.deleteMany({ where: { recipientId: adminUserId } });
    await prisma.incidentHistory.deleteMany({ where: { incident: { examSession: { createdByAdminId: adminUser?.id } } } });
    await prisma.incident.deleteMany({ where: { examSession: { createdByAdminId: adminUser?.id } } });
    await prisma.attendanceHistory.deleteMany({ where: { attendance: { quizStudentAssignment: { examSession: { createdByAdminId: adminUser?.id } } } } });
    await prisma.attendance.deleteMany({ where: { quizStudentAssignment: { examSession: { createdByAdminId: adminUser?.id } } } });
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
    const batch = await prisma.batch.create({ data: { programId, year: '2026', section: `P19-${Date.now()}-${Math.random()}`, subsection: `P19-${Date.now()}-${Math.random()}` } });
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
      .send({
        title: `P19 Quiz ${suffix}-${quizCounter}`,
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
  /** Full pipeline: session -> assign -> allocate -> generate -> finalize seating -> assign invigilator -> mark one student PRESENT -> file one incident. Exercises all 4 report types' underlying data at once. */
  async function buildFullSessionFixture() {
    sessionDayCounter += 1;
    const sessionDate = `2026-12-${String(sessionDayCounter).padStart(2, '0')}`;
    const batchId = await createIsolatedBatch();
    const quizId = await createApprovedQuiz(batchId);
    const studentId = await createEnrolledStudent(batchId);

    const session = await request(app.getHttpServer())
      .post('/exam-sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `P19 Session ${suffix}-${Date.now()}-${Math.random()}`, session_date: sessionDate, start_time: '10:00', end_time: '11:00' })
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

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/exam-sessions/${sessionId}/attendance`)
      .set('Authorization', `Bearer ${invigilatorToken}`)
      .send({ student_id: studentId, status: 'PRESENT', method: 'SEAT_BASED' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/incidents')
      .set('Authorization', `Bearer ${invigilatorToken}`)
      .send({ exam_session_id: sessionId, student_id: studentId, incident_type: 'OTHER', severity: 'LOW', description: 'Report fixture incident' })
      .expect(201);

    return { sessionId, roomId, studentId };
  }

  async function waitForJobCompletion(jobId: string, timeoutMs = 8000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/report-jobs/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      if (res.body.status === 'COMPLETED' || res.body.status === 'FAILED') {
        return res.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`report job ${jobId} did not complete in time`);
  }

  describe('authorization — all 4 POST endpoints + GET/download are ADMIN-only', () => {
    it('rejects unauthenticated / non-ADMIN callers on every report-creation endpoint', async () => {
      const { sessionId } = await buildFullSessionFixture();
      for (const path of ['attendance', 'seating-plan', 'incident-report', 'room-utilization']) {
        await request(app.getHttpServer())
          .post(`/reports/${path}`)
          .send({ exam_session_id: sessionId, format: 'CSV' })
          .expect(401);
        await request(app.getHttpServer())
          .post(`/reports/${path}`)
          .set('Authorization', `Bearer ${facultyToken}`)
          .send({ exam_session_id: sessionId, format: 'CSV' })
          .expect(403);
      }
    });

    it('rejects non-ADMIN callers on GET /report-jobs/{id} and its download route', async () => {
      const { sessionId } = await buildFullSessionFixture();
      const created = await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'CSV' })
        .expect(202);

      await request(app.getHttpServer()).get(`/report-jobs/${created.body.job_id}`).expect(401);
      await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });
  });

  describe('validation', () => {
    it('404s when exam_session_id does not exist', async () => {
      await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: '00000000-0000-0000-0000-000000000000', format: 'CSV' })
        .expect(404);
    });

    it('400s an invalid format value', async () => {
      const { sessionId } = await buildFullSessionFixture();
      await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'PDF' })
        .expect(400);
    });
  });

  describe('POST /reports/attendance — async job -> COMPLETED -> downloadable CSV', () => {
    it('returns 202 {job_id}, completes, and the downloaded CSV reflects the marked attendance', async () => {
      const { sessionId } = await buildFullSessionFixture();

      const created = await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'CSV' })
        .expect(202);
      expect(created.body.job_id).toEqual(expect.any(String));

      const finished = await waitForJobCompletion(created.body.job_id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.download_url).toBe(`/report-jobs/${created.body.job_id}/download`);

      const download = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(download.headers['content-type']).toContain('text/csv');
      expect(download.text).toContain('PRESENT');

      // The requesting admin was notified (ARCHITECTURE.md "signed URL + notification").
      const notifications = await prisma.notification.findMany({
        where: { recipientId: adminUserId, eventType: 'REPORT_READY' },
      });
      expect(notifications.some((n) => (n.payload as any).report_job_id === created.body.job_id)).toBe(true);
    }, 15000);
  });

  describe('POST /reports/seating-plan — EXCEL format', () => {
    it('completes and produces a downloadable XLSX file', async () => {
      const { sessionId } = await buildFullSessionFixture();

      const created = await request(app.getHttpServer())
        .post('/reports/seating-plan')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'EXCEL' })
        .expect(202);

      const finished = await waitForJobCompletion(created.body.job_id);
      expect(finished.status).toBe('COMPLETED');

      const download = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(download.headers['content-type']).toContain('spreadsheetml');
      expect((download.body as Buffer).length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('POST /reports/incident-report', () => {
    it('completes and the CSV reflects the filed incident', async () => {
      const { sessionId } = await buildFullSessionFixture();

      const created = await request(app.getHttpServer())
        .post('/reports/incident-report')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'CSV' })
        .expect(202);
      await waitForJobCompletion(created.body.job_id);

      const download = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(download.text).toContain('Report fixture incident');
    }, 15000);
  });

  describe('POST /reports/room-utilization', () => {
    it('completes and the CSV reflects the allocated room', async () => {
      const { sessionId } = await buildFullSessionFixture();

      const created = await request(app.getHttpServer())
        .post('/reports/room-utilization')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'CSV' })
        .expect(202);
      await waitForJobCompletion(created.body.job_id);

      const download = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(download.text).toContain(building);
    }, 15000);
  });

  describe('empty-result session — reports complete with header-only output, not an error', () => {
    it('an attendance report for a session with zero marked attendance still COMPLETES', async () => {
      const batchId = await createIsolatedBatch();
      const quizId = await createApprovedQuiz(batchId);
      sessionDayCounter += 1;
      const session = await request(app.getHttpServer())
        .post('/exam-sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `P19 Empty ${suffix}-${Date.now()}`, session_date: `2026-12-${String(sessionDayCounter + 20).padStart(2, '0')}`, start_time: '09:00', end_time: '10:00' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/exam-sessions/${session.body.id}/quizzes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ add: [quizId], remove: [] })
        .expect(200);

      const created = await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: session.body.id, format: 'CSV' })
        .expect(202);

      const finished = await waitForJobCompletion(created.body.job_id);
      expect(finished.status).toBe('COMPLETED');

      const download = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(download.text.trim().split('\n')).toHaveLength(1); // header row only
    }, 15000);
  });

  describe('GET /report-jobs/{id}/download — 409 before the job is ready', () => {
    it('409s while the job is still PENDING/RUNNING', async () => {
      const { sessionId } = await buildFullSessionFixture();
      const created = await request(app.getHttpServer())
        .post('/reports/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exam_session_id: sessionId, format: 'CSV' })
        .expect(202);

      // Immediately, before the async worker has necessarily finished —
      // may occasionally already be COMPLETED under a fast test run, so
      // only assert the 409 case when it's genuinely still in flight.
      const immediate = await request(app.getHttpServer())
        .get(`/report-jobs/${created.body.job_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      if (immediate.body.status !== 'COMPLETED') {
        await request(app.getHttpServer())
          .get(`/report-jobs/${created.body.job_id}/download`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(409);
      }
      await waitForJobCompletion(created.body.job_id);
    }, 15000);
  });

  describe('GET /report-jobs/{id} — 404 for a nonexistent job', () => {
    it('404s', async () => {
      await request(app.getHttpServer())
        .get('/report-jobs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
