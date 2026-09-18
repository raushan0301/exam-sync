import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReportFormat, ReportJobStatus, ReportType } from '@exam-sync/db';
import { ReportsService } from './reports.service';
import { ExamSessionsService } from '../exam-session';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return {
    reportJob: { create: jest.fn(), findUnique: jest.fn() },
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: [ROLE.ADMIN] };

describe('ReportsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let examSessionsService: { findById: jest.Mock };
  let reportsQueue: { add: jest.Mock };
  let service: ReportsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    examSessionsService = { findById: jest.fn() };
    reportsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new ReportsService(prisma, examSessionsService as unknown as ExamSessionsService, reportsQueue as any);
  });

  describe('create', () => {
    const dto = { exam_session_id: 's1', format: ReportFormat.CSV };

    it('404s when the exam session does not exist', async () => {
      examSessionsService.findById.mockRejectedValue(new NotFoundException());
      await expect(service.create(ReportType.ATTENDANCE, dto, admin)).rejects.toThrow(NotFoundException);
      expect(prisma.reportJob.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING job row and enqueues it with the job id', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1' });
      const created = { id: 'job-1', status: ReportJobStatus.PENDING };
      prisma.reportJob.create.mockResolvedValue(created);

      const result = await service.create(ReportType.ATTENDANCE, dto, admin);

      expect(result).toEqual(created);
      expect(prisma.reportJob.create).toHaveBeenCalledWith({
        data: { reportType: ReportType.ATTENDANCE, format: ReportFormat.CSV, examSessionId: 's1', requestedByAdminId: 'admin-1' },
      });
      expect(reportsQueue.add).toHaveBeenCalledWith(
        'generate',
        { reportJobId: 'job-1' },
        expect.objectContaining({ jobId: 'job-1' }),
      );
    });
  });

  describe('findById', () => {
    it('404s when the job does not exist', async () => {
      prisma.reportJob.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the job row', async () => {
      prisma.reportJob.findUnique.mockResolvedValue({ id: 'job-1', status: ReportJobStatus.RUNNING });
      const result = await service.findById('job-1');
      expect(result.status).toBe(ReportJobStatus.RUNNING);
    });
  });

  describe('download', () => {
    it('404s when the job does not exist', async () => {
      prisma.reportJob.findUnique.mockResolvedValue(null);
      await expect(service.download('missing')).rejects.toThrow(NotFoundException);
    });

    it('409s when the job is not COMPLETED', async () => {
      prisma.reportJob.findUnique.mockResolvedValue({ id: 'job-1', status: ReportJobStatus.RUNNING, resultData: null });
      await expect(service.download('job-1')).rejects.toThrow(ConflictException);
    });

    it('409s when COMPLETED but resultData is somehow missing (defensive)', async () => {
      prisma.reportJob.findUnique.mockResolvedValue({ id: 'job-1', status: ReportJobStatus.COMPLETED, resultData: null });
      await expect(service.download('job-1')).rejects.toThrow(ConflictException);
    });

    it('returns the stored file when COMPLETED', async () => {
      prisma.reportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: ReportJobStatus.COMPLETED,
        resultData: Buffer.from('a,b\n1,2'),
        resultContentType: 'text/csv',
        resultFilename: 'attendance-s1.csv',
      });

      const file = await service.download('job-1');

      expect(file.contentType).toBe('text/csv');
      expect(file.filename).toBe('attendance-s1.csv');
      expect(file.data.toString()).toBe('a,b\n1,2');
    });
  });
});
