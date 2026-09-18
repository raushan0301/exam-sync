import { HealthController } from './health.controller';

describe('HealthController', () => {
  function buildController(dbOk: boolean, redisOk: boolean) {
    const prisma = {
      $queryRaw: dbOk ? jest.fn().mockResolvedValue([{ '?column?': 1 }]) : jest.fn().mockRejectedValue(new Error('db down')),
    } as never;
    const redis = {
      ping: redisOk ? jest.fn().mockResolvedValue('PONG') : jest.fn().mockRejectedValue(new Error('redis down')),
    } as never;
    return new HealthController(prisma, redis);
  }

  it('returns status ok with a service name, timestamp, and healthy dependencies', async () => {
    const controller = buildController(true, true);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('exam-sync-api');
    expect(typeof result.timestamp).toBe('string');
    expect(result.dependencies.database.status).toBe('ok');
    expect(result.dependencies.redis.status).toBe('ok');
  });

  it('reports status error when the database dependency check fails', async () => {
    const controller = buildController(false, true);
    const result = await controller.check();
    expect(result.status).toBe('error');
    expect(result.dependencies.database.status).toBe('error');
    expect(result.dependencies.database.error).toContain('db down');
    expect(result.dependencies.redis.status).toBe('ok');
  });

  it('reports status error when the redis dependency check fails', async () => {
    const controller = buildController(true, false);
    const result = await controller.check();
    expect(result.status).toBe('error');
    expect(result.dependencies.redis.status).toBe('error');
    expect(result.dependencies.redis.error).toContain('redis down');
  });

  it('live() returns ok without checking any dependency', async () => {
    // Both dependencies mocked to fail — live() must not touch them at all.
    const controller = buildController(false, false);
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('exam-sync-api');
    expect(typeof result.timestamp).toBe('string');
  });
});
