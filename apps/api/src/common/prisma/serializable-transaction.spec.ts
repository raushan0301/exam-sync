import { Prisma } from '@exam-sync/db';
import { runSerializable } from './serializable-transaction';

function p2034() {
  return new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', {
    code: 'P2034',
    clientVersion: '5.22.0',
  });
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function buildPrismaMock() {
  return { $transaction: jest.fn() } as any;
}

describe('runSerializable — ADR-003 (SERIALIZABLE isolation + retry-on-P2034)', () => {
  it('opens the transaction at Serializable isolation', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction.mockResolvedValue('ok');

    await runSerializable(prisma, async () => 'ok');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('returns the callback result on a clean first-attempt success — no retry', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((fn: any) => fn({}));

    const result = await runSerializable(prisma, async () => 'the-result');

    expect(result).toBe('the-result');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('retries transparently on P2034 and succeeds once the conflict clears', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034())
      .mockImplementationOnce((fn: any) => fn({}));

    const result = await runSerializable(prisma, async () => 'succeeded-on-third-try');

    expect(result).toBe('succeeded-on-third-try');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after exhausting its retry budget on persistent P2034s', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction.mockRejectedValue(p2034());

    await expect(runSerializable(prisma, async () => 'never')).rejects.toMatchObject({ code: 'P2034' });
    // Bounded retries — not an infinite loop under sustained contention.
    expect(prisma.$transaction.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does NOT retry a different Prisma error (e.g. P2002) — only P2034 is treated as retryable', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction.mockRejectedValue(p2002());

    await expect(runSerializable(prisma, async () => 'never')).rejects.toMatchObject({ code: 'P2002' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a domain exception thrown inside the callback (e.g. a genuine hard-conflict rejection)', async () => {
    const prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((fn: any) => fn({}));
    const domainError = new Error('hard conflict');

    await expect(
      runSerializable(prisma, async () => {
        throw domainError;
      }),
    ).rejects.toBe(domainError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
