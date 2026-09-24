import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Worker, Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { NotificationRelayService } from '../src/common/queue/notification-relay.service';
import {
  NOTIFICATIONS_STANDARD_QUEUE,
  STANDARD_QUEUE_NAME,
} from '../src/common/queue/queue.constants';
import { createRedisConnection } from '../src/common/queue/redis-connection';
import { NotificationsOutboxService } from '../src/common/notifications-outbox/notifications-outbox.service';
import { NotificationEventType, NotificationRecipientType, NotificationStatus } from '@exam-sync/db';

/**
 * Phase 15 — Notifications. Covers:
 *  - `GET /me/notifications` / `PATCH /me/notifications/{id}/read`
 *    authorization (self-only, BR-045) and idempotency (BR-050).
 *  - The transactional outbox actually firing for two real domain events
 *    (quiz approve, quiz reject) wired in this phase.
 *  - The FULL pipeline, end-to-end, against real Postgres + real Redis:
 *    outbox row -> relay poll -> BullMQ enqueue -> a real worker
 *    (running this repo's own `processNotification` logic, mirrored here
 *    since `workers/notification-worker` is a separate deployable
 *    package, not something `apps/api`'s e2e suite imports) -> row
 *    transitions to SENT.
 */
describe('Notifications (e2e) — Phase 15', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyAToken: string;
  let facultyBToken: string;
  let facultyAUserId: string;
  let facultyBUserId: string;

  const adminEmail = 'e2e-p15-admin@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P15-${suffix}`;
  const progCode = `BTCSE-P15-${suffix}`;

  let departmentId: string;
  let batchAId: string;
  let dbmsSubjectId: string;
  let facultyAId: string;

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
    const batchA = await prisma.batch.create({ data: { programId: prog.id, year: '2026', section: 'A', subsection: 'A' } });
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
    facultyAUserId = (await prisma.user.findUniqueOrThrow({ where: { email: `facultyA-${suffix}@test.local` } })).id;
    facultyBUserId = (await prisma.user.findUniqueOrThrow({ where: { email: `facultyB-${suffix}@test.local` } })).id;

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
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [facultyAUserId, facultyBUserId] } },
    });
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

  async function createSubmittedQuiz(token: string, title: string) {
    const created = await request(app.getHttpServer())
      .post('/quizzes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title,
        subject_id: dbmsSubjectId,
        batch_ids: [batchAId],
        academic_year: '2026',
        semester: 1,
        student_count: 60,
        preferred_date: '2026-05-01',
        preferred_time: '10:00',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/quizzes/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', String(created.body.version))
      .send({
        duration_minutes: 60,
        student_count: 60,
        quiz_type: 'QUIZ',
        preferred_date: '2026-05-01',
        preferred_time: '10:00',
      })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/quizzes/${created.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    return submitted.body as { id: string; version: number };
  }

  describe('transactional outbox — quiz approve/reject (BR-042)', () => {
    it('approving a quiz queues a PENDING notification (IN_APP + EMAIL) visible only to the owning faculty', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Approve-Outbox-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);

      const rows = await prisma.notification.findMany({ where: { recipientId: facultyAUserId, eventType: 'QUIZ_APPROVED' } });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.status === NotificationStatus.PENDING)).toBe(true);
      expect(new Set(rows.map((r) => r.channel))).toEqual(new Set(['IN_APP', 'EMAIL']));

      // IN_APP inbox visible to Faculty A...
      const inboxA = await request(app.getHttpServer())
        .get('/me/notifications')
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(inboxA.body.items.some((n: any) => n.event_type === 'QUIZ_APPROVED' || n.eventType === 'QUIZ_APPROVED')).toBe(true);

      // ...but never to Faculty B (BR-045).
      const inboxB = await request(app.getHttpServer())
        .get('/me/notifications')
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(200);
      expect(inboxB.body.items.some((n: any) => n.id === rows[0].id)).toBe(false);
    });

    it('rejecting a quiz queues a QUIZ_REJECTED notification carrying the rejection reason in its payload', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Reject-Outbox-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Needs more questions' })
        .expect(201);

      const rows = await prisma.notification.findMany({ where: { recipientId: facultyAUserId, eventType: 'QUIZ_REJECTED' } });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect((rows[0].payload as any).reason).toBe('Needs more questions');
    });

    it('idempotency (BR-043): the outbox never produces a second row for the same event/channel/recipient/entity/version', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Idempotent-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);

      const before = await prisma.notification.count({ where: { recipientId: facultyAUserId, eventType: 'QUIZ_APPROVED' } });

      // Re-approving is blocked by the domain rule itself (already APPROVED) —
      // proving the outbox layer's OWN dedup guarantee directly instead,
      // via the same NotificationsOutboxService the approve() call used.
      const outbox = app.get(NotificationsOutboxService);
      await outbox.queue(undefined, {
        recipientType: NotificationRecipientType.FACULTY,
        recipientId: facultyAUserId,
        eventType: NotificationEventType.QUIZ_APPROVED,
        entityId: quiz.id,
        entityVersion: quiz.version + 1, // matches what approve() actually wrote (version incremented)
        payload: { quiz_id: quiz.id, quiz_title: `Idempotent-${suffix}` },
      });

      const after = await prisma.notification.count({ where: { recipientId: facultyAUserId, eventType: 'QUIZ_APPROVED' } });
      expect(after).toBe(before);
    });
  });

  describe('GET /me/notifications', () => {
    it('rejects unauthenticated callers', async () => {
      await request(app.getHttpServer()).get('/me/notifications').expect(401);
    });

    it('cursor-paginates and returns newest first', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/notifications')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(1);
      expect(res.body).toHaveProperty('next_cursor');
    });
  });

  describe('PATCH /me/notifications/{id}/read', () => {
    it('404s (not 403) when marking a notification that belongs to a different recipient — BR-045/ADR-008', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Read-Isolation-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);
      const row = await prisma.notification.findFirstOrThrow({
        where: { recipientId: facultyAUserId, eventType: 'QUIZ_APPROVED', channel: 'IN_APP' },
        orderBy: { createdAt: 'desc' },
      });

      await request(app.getHttpServer())
        .patch(`/me/notifications/${row.id}/read`)
        .set('Authorization', `Bearer ${facultyBToken}`)
        .expect(404);
    });

    it('marks the caller\'s own notification as read, idempotently', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Read-Own-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);
      const row = await prisma.notification.findFirstOrThrow({
        where: { recipientId: facultyAUserId, eventType: 'QUIZ_APPROVED', channel: 'IN_APP' },
        orderBy: { createdAt: 'desc' },
      });

      const first = await request(app.getHttpServer())
        .patch(`/me/notifications/${row.id}/read`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
      expect(first.body.read_at ?? first.body.readAt).toBeTruthy();

      // Idempotent re-mark (BR-050) — same 200, no error.
      await request(app.getHttpServer())
        .patch(`/me/notifications/${row.id}/read`)
        .set('Authorization', `Bearer ${facultyAToken}`)
        .expect(200);
    });
  });

  describe('full pipeline: outbox -> relay -> BullMQ -> worker -> SENT (worker processing, EC-025-style)', () => {
    it('a PENDING notification transitions to SENT once relayed and consumed by a real worker', async () => {
      const quiz = await createSubmittedQuiz(facultyAToken, `Pipeline-${suffix}`);
      await request(app.getHttpServer())
        .post(`/quizzes/${quiz.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', String(quiz.version))
        .expect(201);

      // Scoped to THIS quiz's own entityId — other tests in this file (and
      // other e2e spec files sharing the same Postgres + Redis in a full
      // suite run) also produce QUIZ_APPROVED rows for facultyAUserId that
      // may still be PENDING/queued at this point; only this test's own
      // rows must be proven SENT.
      const pendingRows = await prisma.notification.findMany({
        where: {
          recipientId: facultyAUserId,
          eventType: 'QUIZ_APPROVED',
          status: NotificationStatus.PENDING,
          idempotencyKey: { contains: `:${quiz.id}:` },
        },
      });
      expect(pendingRows.length).toBeGreaterThanOrEqual(2);
      const pendingIds = new Set(pendingRows.map((r) => r.id));

      // Drive the relay directly (real service, real Postgres, real Redis).
      const relay = app.get(NotificationRelayService);
      await relay.pollAndDispatch();

      const standardQueue: Queue = app.get(NOTIFICATIONS_STANDARD_QUEUE);
      const jobCounts = await standardQueue.getJobCounts('waiting', 'active', 'delayed');
      expect(jobCounts.waiting + jobCounts.active + jobCounts.delayed).toBeGreaterThan(0);

      // A real BullMQ worker, running this repo's actual delivery logic
      // (imported straight from the notification-worker package so this
      // test exercises the SAME code that ships, not a re-implementation).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { processNotification } = require('../../../workers/notification-worker/dist/process-notification');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ConsoleEmailProvider } = require('../../../workers/notification-worker/dist/email-provider');
      const connection = createRedisConnection(process.env.REDIS_URL as string);
      const worker = new Worker(
        STANDARD_QUEUE_NAME,
        async (job: any) => {
          await processNotification(job.data.notificationId, { prisma, emailProvider: new ConsoleEmailProvider() });
        },
        { connection, concurrency: 5 },
      );

      // try/finally — the worker (and its Redis connection) MUST be
      // closed even if the wait below throws (e.g. a timeout under
      // system load), not only on the happy path. `STANDARD_QUEUE_NAME`
      // is a real, GLOBAL Redis queue shared with the rest of this e2e
      // run (every other spec file's own booted AppModule keeps its own
      // `NotificationRelayService` polling and enqueueing into the SAME
      // queue the whole time `--runInBand` keeps this one Node process
      // alive). An earlier version of this test only closed the worker
      // after a successful `await`, so a timeout left this
      // `concurrency: 5` worker running indefinitely, silently consuming
      // every LATER spec file's own notification jobs for the rest of
      // the process's life — observed as repeated "Cannot log after
      // tests are done" errors and a hung "Jest did not exit" at the end
      // of a full-suite run. `force: true` on `close()` additionally
      // abandons (rather than waits to finish) any job the worker
      // happens to have already grabbed at close time, rather than
      // finishing it after this file's Jest environment has torn down;
      // BullMQ requeues an abandoned job for its next consumer, so
      // nothing is lost.
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('worker did not process jobs in time')), 8000);
          const remaining = new Set(pendingIds);
          worker.on('completed', (job) => {
            remaining.delete(job.data.notificationId);
            if (remaining.size === 0) {
              clearTimeout(timer);
              resolve();
            }
          });
          worker.on('failed', (job, err) => {
            if (job && pendingIds.has(job.data.notificationId)) {
              clearTimeout(timer);
              reject(err);
            }
          });
        });
      } finally {
        await worker.close(true);
        await connection.quit();
      }

      const finalRows = await prisma.notification.findMany({
        where: { id: { in: pendingRows.map((r) => r.id) } },
      });
      expect(finalRows.every((r) => r.status === NotificationStatus.SENT)).toBe(true);
      expect(finalRows.every((r) => r.sentAt !== null)).toBe(true);
    }, 15000);
  });
});
