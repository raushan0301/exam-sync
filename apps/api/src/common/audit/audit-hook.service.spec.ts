import { AuditHookService } from './audit-hook.service';
import { AuthenticatedUser } from '../auth/auth.types';

function buildPrismaMock() {
  return {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('AuditHookService', () => {
  it('writes an audit_logs row via the default (injected) prisma client when no tx is passed', async () => {
    const prisma = buildPrismaMock();
    const service = new AuditHookService(prisma);

    await service.record({
      actor,
      action: 'CREATE',
      entityType: 'Room',
      entityId: 'room-1',
      newValue: { id: 'room-1', name: 'Room 101' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.actorId).toBe('admin-1');
    expect(data.action).toBe('CREATE');
    expect(data.entityType).toBe('Room');
    expect(data.entityId).toBe('room-1');
  });

  it('writes through the explicitly-passed transaction client, not the injected default (BR-048)', async () => {
    const prisma = buildPrismaMock();
    const tx = { auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-2' }) } } as any;
    const service = new AuditHookService(prisma);

    await service.record(
      { actor, action: 'UPDATE', entityType: 'Quiz', entityId: 'quiz-1', oldValue: {}, newValue: {} },
      tx,
    );

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('redacts sensitive fields from oldValue/newValue before persisting', async () => {
    const prisma = buildPrismaMock();
    const service = new AuditHookService(prisma);

    await service.record({
      actor,
      action: 'UPDATE',
      entityType: 'User',
      entityId: 'user-1',
      oldValue: { id: 'user-1', passwordHash: 'old-hash' },
      newValue: { id: 'user-1', passwordHash: 'new-hash' },
    });

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.oldValue.passwordHash).toBe('[REDACTED]');
    expect(data.newValue.passwordHash).toBe('[REDACTED]');
  });

  it('persists the reason and derives academicYear from newValue when present', async () => {
    const prisma = buildPrismaMock();
    const service = new AuditHookService(prisma);

    await service.record({
      actor,
      action: 'UPDATE',
      entityType: 'Quiz',
      entityId: 'quiz-1',
      oldValue: { id: 'quiz-1', academicYear: 2025 },
      newValue: { id: 'quiz-1', academicYear: 2026 },
      reason: 'Rescheduled per admin request',
    });

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.reason).toBe('Rescheduled per admin request');
    expect(data.academicYear).toBe(2026);
  });

  it('stores JsonNull (not undefined) when oldValue is absent, e.g. a CREATE', async () => {
    const prisma = buildPrismaMock();
    const service = new AuditHookService(prisma);

    await service.record({
      actor,
      action: 'CREATE',
      entityType: 'Room',
      entityId: 'room-2',
      newValue: { id: 'room-2' },
    });

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.oldValue).not.toBeUndefined();
  });

  describe('recordMany', () => {
    it('writes one audit row per event with a SINGLE createMany through the passed tx', async () => {
      const prisma = buildPrismaMock();
      const tx = { auditLog: { create: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 2 }) } } as any;
      const service = new AuditHookService(prisma);

      await service.recordMany(
        [
          { actor, action: 'CREATE', entityType: 'Thing', entityId: 'a', newValue: { id: 'a' } },
          { actor, action: 'CREATE', entityType: 'Thing', entityId: 'b', newValue: { id: 'b', passwordHash: 'secret' } },
        ],
        tx,
      );

      expect(tx.auditLog.createMany).toHaveBeenCalledTimes(1);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      const data = tx.auditLog.createMany.mock.calls[0][0].data;
      expect(data.map((d: any) => d.entityId)).toEqual(['a', 'b']);
      expect(JSON.stringify(data[1].newValue)).not.toContain('secret'); // same redaction as record()
    });

    it('is a no-op for an empty list', async () => {
      const tx = { auditLog: { createMany: jest.fn() } } as any;
      await new AuditHookService(buildPrismaMock()).recordMany([], tx);
      expect(tx.auditLog.createMany).not.toHaveBeenCalled();
    });
  });
});
