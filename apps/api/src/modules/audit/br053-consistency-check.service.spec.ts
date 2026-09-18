import { Logger } from '@nestjs/common';
import { Br053ConsistencyCheckService } from './br053-consistency-check.service';

function buildPrismaMock(groupByResult: any[]) {
  return {
    examSessionQuiz: {
      groupBy: jest.fn().mockResolvedValue(groupByResult),
    },
  } as any;
}

describe('Br053ConsistencyCheckService', () => {
  it('does not log an error when no quiz is attached to more than one non-cancelled session', async () => {
    const prisma = buildPrismaMock([]);
    const service = new Br053ConsistencyCheckService(prisma);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.check();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs an error naming the offending quiz ids when a BR-053 violation is found', async () => {
    const prisma = buildPrismaMock([{ quizId: 'quiz-1', _count: { quizId: 2 } }]);
    const service = new Br053ConsistencyCheckService(prisma);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.check();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('quiz-1');
    expect(errorSpy.mock.calls[0][0]).toContain('BR-053');
    errorSpy.mockRestore();
  });

  it('scopes the query to active attachments on non-cancelled sessions only', async () => {
    const prisma = buildPrismaMock([]);
    const service = new Br053ConsistencyCheckService(prisma);

    await service.check();

    const args = prisma.examSessionQuiz.groupBy.mock.calls[0][0];
    expect(args.where.isActiveAttachment).toBe(true);
    expect(args.where.examSession.status.not).toBe('CANCELLED');
    expect(args.having.quizId._count.gt).toBe(1);
  });
});
