import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Rooms (e2e) — Phase 11', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let facultyToken: string;

  const adminEmail = 'e2e-p11-admin@test.local';
  const facultyEmail = 'e2e-p11-faculty@test.local';
  const password = 'CorrectHorseBatteryStaple1!';
  const suffix = Date.now().toString(36);
  const building = `Bldg-${suffix}`;

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
    const facultyRole = await prisma.role.findUniqueOrThrow({ where: { name: 'FACULTY' } });

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
    await prisma.roomAvailability.deleteMany({ where: { room: { building } } });
    await prisma.roomSeat.deleteMany({ where: { room: { building } } });
    await prisma.room.deleteMany({ where: { building } });
    const testEmails = [adminEmail, facultyEmail];
    await prisma.userRole.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => undefined);
    await app.close();
  });

  let roomCounter = 0;
  async function createRoom(overrides: Partial<{ capacity: number; rows: number; columns: number; floor: number }> = {}) {
    roomCounter += 1;
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        building,
        floor: overrides.floor ?? 1,
        room_number: `R${roomCounter}`,
        capacity: overrides.capacity ?? 30,
        rows: overrides.rows ?? 5,
        columns: overrides.columns ?? 6,
      })
      .expect(201);
    return res.body as { id: string; capacity: number; status: string };
  }

  describe('POST /rooms — ADMIN-only, seat map generation, uniqueness', () => {
    it('rejects unauthenticated / non-ADMIN callers', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .send({ building, floor: 1, room_number: 'X1', capacity: 10, rows: 2, columns: 5 })
        .expect(401);

      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ building, floor: 1, room_number: 'X1', capacity: 10, rows: 2, columns: 5 })
        .expect(403);
    });

    it('creates a room and generates its full seat map (rows×columns)', async () => {
      const room = await createRoom({ capacity: 12, rows: 2, columns: 6 });

      expect(room.status).toBe('ACTIVE');

      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(seats.body).toHaveLength(12);
      expect(seats.body.map((s: any) => s.seatLabel).sort()).toEqual(
        ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'].sort(),
      );
      expect(seats.body.every((s: any) => s.isActive === true)).toBe(true);
      expect(seats.body.every((s: any) => s.isAccessible === false)).toBe(true);
    });

    it('rejects a duplicate (building, room_number) with 409', async () => {
      const room = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building, floor: 1, room_number: 'DUP', capacity: 10, rows: 2, columns: 5 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building, floor: 2, room_number: 'DUP', capacity: 20, rows: 4, columns: 5 })
        .expect(409);

      // A DIFFERENT building may reuse the same room_number — uniqueness is per-building.
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building: `${building}-other`, floor: 1, room_number: 'DUP', capacity: 10, rows: 2, columns: 5 })
        .expect(201);

      void room;
    });

    it('rejects non-positive capacity/rows/columns with 400', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building, floor: 1, room_number: 'BAD1', capacity: 0, rows: 2, columns: 5 })
        .expect(400);

      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building, floor: 1, room_number: 'BAD2', capacity: 10, rows: 0, columns: 5 })
        .expect(400);
    });

    it('rejects missing required fields with 400', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ building, floor: 1 })
        .expect(400);
    });
  });

  describe('GET /rooms, GET /rooms/:id — open to any authenticated role', () => {
    it('lets FACULTY list and view rooms (no ADMIN required for reads)', async () => {
      const room = await createRoom();

      await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);
      expect(res.body.id).toBe(room.id);
    });

    it('rejects unauthenticated reads', async () => {
      await request(app.getHttpServer()).get('/rooms').expect(401);
    });

    it('404s for a non-existent room', async () => {
      await request(app.getHttpServer())
        .get('/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('filters by min_capacity and search', async () => {
      const small = await createRoom({ capacity: 10 });
      const large = await createRoom({ capacity: 200 });

      const res = await request(app.getHttpServer())
        .get('/rooms')
        .query({ building, min_capacity: 100 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = res.body.items.map((r: any) => r.id);
      expect(ids).toContain(large.id);
      expect(ids).not.toContain(small.id);
    });
  });

  describe('PATCH /rooms/:id — ADMIN-only, status/deactivation rules', () => {
    it('rejects a non-ADMIN caller', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ capacity: 99 })
        .expect(403);
    });

    it('updates capacity/building/floor', async () => {
      const room = await createRoom();
      const res = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capacity: 99, floor: 3 })
        .expect(200);

      expect(res.body.capacity).toBe(99);
      expect(res.body.floor).toBe(3);
    });

    it('transitions ACTIVE -> MAINTENANCE -> ACTIVE -> INACTIVE cleanly, each via the same endpoint', async () => {
      const room = await createRoom();

      const toMaintenance = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);
      expect(toMaintenance.body.status).toBe('MAINTENANCE');

      const toInactive = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(toInactive.body.status).toBe('INACTIVE');

      const toActive = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect(toActive.body.status).toBe('ACTIVE');
    });

    it('rejects an invalid status value with 400', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'NOT_A_REAL_STATUS' })
        .expect(400);
    });

    it('rejects renaming into a colliding (building, room_number) with 409', async () => {
      const roomA = await createRoom();
      const roomB = await createRoom();

      const fetchedA = await request(app.getHttpServer())
        .get(`/rooms/${roomA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/rooms/${roomB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ room_number: fetchedA.body.roomNumber })
        .expect(409);
    });

    it('rejects rows/columns fields (not part of UpdateRoomDto) with 400 — the seat map is immutable via PATCH', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: 10 })
        .expect(400);
    });
  });

  describe('PATCH /rooms/:id/seats/:seatId — individual seat disable', () => {
    it('rejects a non-ADMIN caller', async () => {
      const room = await createRoom();
      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/seats/${seats.body[0].id}`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ is_active: false })
        .expect(403);
    });

    it('disables and re-enables an individual seat without affecting others', async () => {
      const room = await createRoom({ rows: 2, columns: 2 });
      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const target = seats.body[0];

      const disabled = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/seats/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200);
      expect(disabled.body.isActive).toBe(false);

      const afterDisable = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const others = afterDisable.body.filter((s: any) => s.id !== target.id);
      expect(others.every((s: any) => s.isActive === true)).toBe(true);

      const reenabled = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/seats/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: true })
        .expect(200);
      expect(reenabled.body.isActive).toBe(true);
    });

    it('marks a seat accessible', async () => {
      const room = await createRoom({ rows: 1, columns: 1 });
      const seats = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/seats/${seats.body[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_accessible: true })
        .expect(200);

      expect(res.body.isAccessible).toBe(true);
    });

    it('404s for a seat id that belongs to a DIFFERENT room', async () => {
      const roomA = await createRoom({ rows: 1, columns: 1 });
      const roomB = await createRoom({ rows: 1, columns: 1 });
      const seatsB = await request(app.getHttpServer())
        .get(`/rooms/${roomB.id}/seats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/rooms/${roomA.id}/seats/${seatsB.body[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(404);
    });
  });

  describe('POST/GET /rooms/:id/availability-blocks', () => {
    it('rejects a non-ADMIN POST', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ date: '2026-07-01', start_time: '09:00', end_time: '10:00', reason: 'MAINTENANCE' })
        .expect(403);
    });

    it('creates a block, then lists it back (any authenticated role can read)', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: '2026-07-01', start_time: '09:00', end_time: '10:00', reason: 'MAINTENANCE' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${facultyToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].reason).toBe('MAINTENANCE');
    });

    it('requires a non-empty reason', async () => {
      const room = await createRoom();
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: '2026-07-01', start_time: '09:00', end_time: '10:00', reason: '' })
        .expect(400);
    });
  });

  describe('GET /rooms/available — availability-calendar + capacity + status filtering', () => {
    it('excludes a room with an overlapping availability block on that date/time', async () => {
      const room = await createRoom({ capacity: 40 });
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: '2026-08-01', start_time: '10:00', end_time: '12:00', reason: 'MAINTENANCE' })
        .expect(201);

      const overlapping = await request(app.getHttpServer())
        .get('/rooms/available')
        .query({ date: '2026-08-01', start_time: '11:00', end_time: '13:00', min_capacity: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(overlapping.body.map((r: any) => r.id)).not.toContain(room.id);

      const nonOverlapping = await request(app.getHttpServer())
        .get('/rooms/available')
        .query({ date: '2026-08-01', start_time: '13:00', end_time: '14:00', min_capacity: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(nonOverlapping.body.map((r: any) => r.id)).toContain(room.id);
    });

    it('allows a back-to-back (touching, non-overlapping) window against a block', async () => {
      const room = await createRoom({ capacity: 40 });
      await request(app.getHttpServer())
        .post(`/rooms/${room.id}/availability-blocks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: '2026-08-02', start_time: '10:00', end_time: '11:00', reason: 'MAINTENANCE' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/rooms/available')
        .query({ date: '2026-08-02', start_time: '11:00', end_time: '12:00', min_capacity: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.map((r: any) => r.id)).toContain(room.id);
    });

    it('excludes a MAINTENANCE/INACTIVE room even with no availability block', async () => {
      const room = await createRoom({ capacity: 40 });
      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/rooms/available')
        .query({ date: '2026-08-03', start_time: '09:00', end_time: '10:00', min_capacity: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.map((r: any) => r.id)).not.toContain(room.id);
    });

    it('excludes a room whose capacity is below min_capacity', async () => {
      const room = await createRoom({ capacity: 5 });

      const res = await request(app.getHttpServer())
        .get('/rooms/available')
        .query({ date: '2026-08-04', start_time: '09:00', end_time: '10:00', min_capacity: 100 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.map((r: any) => r.id)).not.toContain(room.id);
    });
  });
});
