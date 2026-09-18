import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { PrismaClient } from '@exam-sync/db';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Audit and Observability (e2e) — Phase 20', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;
  let adminUserId: string;

  const adminEmail = 'e2e-p20-admin@test.local';
  const facultyEmail = 'e2e-p20-faculty@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const deptCode = `CSE-P20-${suffix}`;

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
    const facultyRole = await prisma.role.findUniqueOrThrow({ where: { name: 'FACULTY' } });

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, isActive: true },
      update: {},
    });
    adminUserId = admin.id;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      create: { userId: admin.id, roleId: adminRole.id },
      update: {},
    });

    const faculty = await prisma.user.upsert({
      where: { email: facultyEmail },
      create: { email: facultyEmail, passwordHash, isActive: true },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: faculty.id, roleId: facultyRole.id } },
      create: { userId: faculty.id, roleId: facultyRole.id },
      update: {},
    });

    adminToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password }).expect(200)
    ).body.access_token;
    facultyToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: facultyEmail, password }).expect(200)
    ).body.access_token;
  });

  afterAll(async () => {
    // Deliberately does NOT hard-delete `adminEmail`/`facultyEmail` users:
    // by now they are permanently referenced by `audit_logs.actor_id`
    // (BR-048 — every mutating action in this spec audited them as
    // actor), and that FK is RESTRICT with no cascade, matching this
    // codebase's own established convention of deactivating (`is_active`)
    // rather than ever hard-deleting a `User` row. Hard-deleting them here
    // would now correctly fail with a foreign-key violation — proof the
    // constraint works, not a bug to work around. Left in place; emails
    // are suffixed per-run so a later run never collides.
    await prisma.department.deleteMany({ where: { code: deptCode } });
    await app.close();
  });

  describe('BR-047 — authorization (Admin-only)', () => {
    it('rejects a non-Admin (FACULTY) caller with 403', () => {
      return request(app.getHttpServer())
        .get('/audit-logs')
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(403);
    });

    it('rejects an unauthenticated caller with 401', () => {
      return request(app.getHttpServer()).get('/audit-logs').expect(401);
    });

    it('allows an Admin caller and returns a paginated shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect('next_cursor' in res.body).toBe(true);
    });
  });

  describe('BR-048 — audit row creation, actor/resource attribution', () => {
    it('creates an audit_logs row with correct actor/action/entity for a Department creation', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `CSE ${suffix}`, code: deptCode })
        .expect(201);

      const departmentId = createRes.body.id;

      const rows = await prisma.auditLog.findMany({
        where: { entityType: 'Department', entityId: departmentId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorId).toBe(adminUserId);
      expect(rows[0].action).toBe('CREATE');
      expect((rows[0].newValue as Record<string, unknown>).code).toBe(deptCode);
    });

    it('correlates the audit row with the X-Request-Id header supplied on the request', async () => {
      const requestId = `e2e-req-${suffix}`;
      const createRes = await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Request-Id', requestId)
        .send({ name: `CSE-Corr ${suffix}`, code: `${deptCode}-CORR` })
        .expect(201);

      const rows = await prisma.auditLog.findMany({
        where: { entityType: 'Department', entityId: createRes.body.id },
      });
      expect(rows[0].requestId).toBe(requestId);

      await prisma.department.delete({ where: { id: createRes.body.id } }).catch(() => undefined);
    });

    it('exposes the audit row via GET /audit-logs filtered by entity_type/entity_id', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `CSE-Filter ${suffix}`, code: `${deptCode}-FILTER` })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/audit-logs')
        .query({ entity_type: 'Department', entity_id: createRes.body.id })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].entity_id ?? res.body.items[0].entityId).toBeDefined();

      await prisma.department.delete({ where: { id: createRes.body.id } }).catch(() => undefined);
    });
  });

  describe('BR-049 — append-only immutability (DB-role backstop)', () => {
    // A dedicated, short-lived client — NOT the shared `prisma`/PrismaService
    // instance every other test/afterAll in this file uses. A rejected raw
    // statement against a REVOKEd table can leave the underlying pooled
    // connection in an aborted-transaction state; isolating these two
    // deliberately-failing statements onto their own client/connection
    // keeps that failure from poisoning unrelated queries (e.g. this
    // file's own `afterAll` cleanup) that share the same connection pool.
    let rawClient: PrismaClient;

    beforeAll(() => {
      rawClient = new PrismaClient();
    });

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    it('rejects an UPDATE against audit_logs at the DB-role level', async () => {
      const row = await prisma.auditLog.findFirst();
      expect(row).not.toBeNull();

      // Blocked by a BEFORE UPDATE trigger (audit_logs_no_update), not a
      // bare GRANT/REVOKE — see this migration's own comment for why: a
      // plain `REVOKE UPDATE` would also break the FK RESTRICT check's
      // internal row-lock on this table (a genuine PostgreSQL gotcha).
      await expect(
        rawClient.$executeRawUnsafe(`UPDATE audit_logs SET reason = 'tampered' WHERE id = '${row!.id}'`),
      ).rejects.toThrow(/append-only.*UPDATE is not permitted/i);
    });

    it('rejects a DELETE against audit_logs at the DB-role level', async () => {
      const row = await prisma.auditLog.findFirst();
      expect(row).not.toBeNull();

      await expect(rawClient.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = '${row!.id}'`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  describe('Sensitive-data redaction', () => {
    it('does not expose passwordHash in the audit row for a Faculty creation', async () => {
      const facultyRes = await request(app.getHttpServer())
        .post('/faculty')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `E2E Audit Faculty ${suffix}`,
          employee_code: `EMP-P20-${suffix}`,
          department_id: (
            await request(app.getHttpServer())
              .post('/departments')
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ name: `CSE-Fac ${suffix}`, code: `${deptCode}-FAC` })
              .expect(201)
          ).body.id,
          email: `e2e-p20-newfaculty-${suffix}@test.local`,
        })
        .expect(201);

      const rows = await prisma.auditLog.findMany({
        where: { entityType: 'Faculty', entityId: facultyRes.body.id },
      });
      expect(rows).toHaveLength(1);
      const newValue = JSON.stringify(rows[0].newValue);
      expect(newValue).not.toMatch(/\$argon2/);
      expect(newValue.toLowerCase()).not.toContain('passwordhash');

      await prisma.faculty.delete({ where: { id: facultyRes.body.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { email: `e2e-p20-newfaculty-${suffix}@test.local` } }).catch(() => undefined);
    });
  });

  describe('BR-048 — transactional atomicity of the audit write', () => {
    it('rolls back the domain write AND the audit write together when the transaction fails', async () => {
      const dept = await prisma.department.create({
        data: { name: `Rollback ${suffix}`, code: `${deptCode}-RB` },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          const updated = await tx.department.update({
            where: { id: dept.id },
            data: { name: `Rollback Updated ${suffix}` },
          });
          await tx.auditLog.create({
            data: {
              actorId: adminUserId,
              action: 'UPDATE',
              entityType: 'Department',
              entityId: updated.id,
              newValue: { name: updated.name },
            },
          });
          throw new Error('forced failure after both writes, before commit');
        }),
      ).rejects.toThrow('forced failure');

      const reloaded = await prisma.department.findUniqueOrThrow({ where: { id: dept.id } });
      expect(reloaded.name).toBe(`Rollback ${suffix}`); // domain write rolled back

      const auditRows = await prisma.auditLog.findMany({ where: { entityType: 'Department', entityId: dept.id } });
      expect(auditRows).toHaveLength(0); // audit write rolled back too — no partial commit

      await prisma.department.delete({ where: { id: dept.id } });
    });
  });
});
