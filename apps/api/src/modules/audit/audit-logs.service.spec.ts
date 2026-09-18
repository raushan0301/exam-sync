import { AuditLogsService } from './audit-logs.service';

function buildPrismaMock(rows: any[]) {
  return {
    auditLog: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as any;
}

describe('AuditLogsService', () => {
  it('applies entity_type/entity_id/actor_id filters', async () => {
    const prisma = buildPrismaMock([]);
    const service = new AuditLogsService(prisma);

    await service.list({ entityType: 'Quiz', entityId: 'quiz-1', actorId: 'admin-1' });

    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.where.entityType).toBe('Quiz');
    expect(args.where.entityId).toBe('quiz-1');
    expect(args.where.actorId).toBe('admin-1');
  });

  it('applies a date range filter', async () => {
    const prisma = buildPrismaMock([]);
    const service = new AuditLogsService(prisma);

    await service.list({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });

    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(args.where.createdAt.lte).toEqual(new Date('2026-01-31'));
  });

  it('paginates via cursor and returns next_cursor when more rows exist than the limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `log-${i}`, createdAt: new Date() }));
    const prisma = buildPrismaMock(rows);
    const service = new AuditLogsService(prisma);

    const result = await service.list({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.next_cursor).toBe('log-1');
  });

  it('orders by createdAt descending (most recent audit activity first)', async () => {
    const prisma = buildPrismaMock([]);
    const service = new AuditLogsService(prisma);

    await service.list({});

    const args = prisma.auditLog.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });
});
