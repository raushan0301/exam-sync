import * as fs from 'fs';
import * as path from 'path';
import { QuizApprovalAction, QuizStatus } from '@exam-sync/db';
import { QuizApprovalHistoryService } from './quiz-approval-history.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Strips `/** ... *\/` and `// ...` comments before the inspection tests
 * scan for real `.update(`/`.delete(` calls — without this, a file's own
 * doc comments explaining what NOT to do (as this file's sibling
 * intentionally has) would trip the check as a false positive. This is a
 * simple, deliberately non-exhaustive stripper (doesn't handle strings
 * containing `//`), sufficient for scanning this codebase's own
 * consistently-formatted TypeScript source.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function buildPrismaMock() {
  return {
    quizApprovalHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
      // Deliberately included in the MOCK (not the real service) so the
      // repository-layer inspection test below has something to assert
      // was never actually called/referenced by the service's source.
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as any;
}

describe('QuizApprovalHistoryService — BR-013 append-only ledger', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: QuizApprovalHistoryService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new QuizApprovalHistoryService(prisma as unknown as PrismaService);
  });

  it('records a history row via create (never update)', async () => {
    prisma.quizApprovalHistory.create.mockResolvedValue({ id: 'h1' });

    await service.record({
      quizId: 'q1',
      action: QuizApprovalAction.APPROVED,
      actorId: 'admin-1',
      previousStatus: QuizStatus.SUBMITTED,
      newStatus: QuizStatus.APPROVED,
    });

    expect(prisma.quizApprovalHistory.create).toHaveBeenCalledWith({
      data: {
        quizId: 'q1',
        action: QuizApprovalAction.APPROVED,
        actorId: 'admin-1',
        reason: null,
        previousStatus: QuizStatus.SUBMITTED,
        newStatus: QuizStatus.APPROVED,
      },
    });
    expect(prisma.quizApprovalHistory.update).not.toHaveBeenCalled();
    expect(prisma.quizApprovalHistory.delete).not.toHaveBeenCalled();
  });

  it('lists a quiz\'s history in chronological order', async () => {
    prisma.quizApprovalHistory.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    await expect(service.listForQuiz('q1')).resolves.toEqual([{ id: 'h1' }, { id: 'h2' }]);
    expect(prisma.quizApprovalHistory.findMany).toHaveBeenCalledWith({
      where: { quizId: 'q1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  describe('repository-layer inspection (IMPLEMENTATION_PLAN.md Phase 7: "structurally impossible via any code path")', () => {
    it('the service class exposes no update or delete method on its own prototype', () => {
      const ownMethodNames = Object.getOwnPropertyNames(QuizApprovalHistoryService.prototype);
      expect(ownMethodNames).not.toContain('update');
      expect(ownMethodNames).not.toContain('delete');
      expect(ownMethodNames).not.toContain('remove');
      // Exactly the two sanctioned append/read operations, plus the
      // implicit constructor — nothing else exists to (mis)use.
      expect(ownMethodNames.sort()).toEqual(['constructor', 'listForQuiz', 'record'].sort());
    });

    it('the service source never references prisma.quizApprovalHistory.update or .delete', () => {
      const source = stripComments(
        fs.readFileSync(path.join(__dirname, 'quiz-approval-history.service.ts'), 'utf8'),
      );
      expect(source).not.toMatch(/quizApprovalHistory\.update/);
      expect(source).not.toMatch(/quizApprovalHistory\.delete/);
    });

    it('no OTHER file in the quiz module calls prisma.quizApprovalHistory.update or .delete either', () => {
      const moduleDir = __dirname;
      const offendingFiles: string[] = [];
      for (const file of fs.readdirSync(moduleDir)) {
        if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
        const source = stripComments(fs.readFileSync(path.join(moduleDir, file), 'utf8'));
        if (/quizApprovalHistory\.(update|delete)/.test(source)) {
          offendingFiles.push(file);
        }
      }
      expect(offendingFiles).toEqual([]);
    });
  });
});
