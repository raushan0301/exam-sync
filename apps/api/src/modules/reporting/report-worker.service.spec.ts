import { ReportFormat, ReportJobStatus, ReportType } from '@exam-sync/db';
import { ReportWorkerService } from './report-worker.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';

function buildPrismaMock() {
  const tx = {
    reportJob: { update: jest.fn() },
  };
  return {
    reportJob: { findUnique: jest.fn(), update: jest.fn() },
    examSession: { findUnique: jest.fn().mockResolvedValue({ name: 'Test Session', sessionDate: new Date('2026-01-15') }) },
    attendance: { findMany: jest.fn() },
    seatingPlan: { findMany: jest.fn() },
    incident: { findMany: jest.fn() },
    examSessionRoom: { findMany: jest.fn() },
    seatingAssignment: { groupBy: jest.fn() },
    roomSeat: { findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const pendingJob = {
  id: 'job-1',
  reportType: ReportType.ATTENDANCE,
  format: ReportFormat.CSV,
  examSessionId: 's1',
  status: ReportJobStatus.PENDING,
  requestedByAdminId: 'admin-user-1',
};

describe('ReportWorkerService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let notificationsOutbox: { queue: jest.Mock };
  let service: ReportWorkerService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    notificationsOutbox = { queue: jest.fn() };
    service = new ReportWorkerService(
      prisma as unknown as PrismaService,
      notificationsOutbox as unknown as NotificationsOutboxService,
      {} as any, // Redis connection — never used by `process()` itself, only by `onModuleInit`'s real Worker
    );
  });

  it('is a no-op when the job no longer exists', async () => {
    prisma.reportJob.findUnique.mockResolvedValue(null);
    await (service as any).process('missing');
    expect(prisma.reportJob.update).not.toHaveBeenCalled();
  });

  it('is a no-op when the job is not PENDING (idempotent against BullMQ redelivery)', async () => {
    prisma.reportJob.findUnique.mockResolvedValue({ ...pendingJob, status: ReportJobStatus.COMPLETED });
    await (service as any).process('job-1');
    expect(prisma.reportJob.update).not.toHaveBeenCalled();
  });

  it('runs an ATTENDANCE report end-to-end: RUNNING -> COMPLETED with file data, then notifies the requesting admin', async () => {
    prisma.reportJob.findUnique.mockResolvedValue(pendingJob);
    prisma.attendance.findMany.mockResolvedValue([
      {
        quizStudentAssignment: { student: { name: 'Ada', rollNumber: 'R1' }, quiz: { title: 'DBMS' } },
        seat: { seatLabel: 'A1' },
        status: 'PRESENT',
        method: 'SEAT_BASED',
        markedAt: new Date('2026-01-01T10:00:00Z'),
        locked: false,
      },
    ]);

    await (service as any).process('job-1');

    expect(prisma.reportJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: ReportJobStatus.RUNNING },
    });
    expect(prisma.__tx.reportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: ReportJobStatus.COMPLETED,
          resultUrl: '/report-jobs/job-1/download',
          resultContentType: 'text/csv',
        }),
      }),
    );
    const updateCall = prisma.__tx.reportJob.update.mock.calls[0][0];
    expect((updateCall.data.resultData as Buffer).toString()).toContain('Ada');

    expect(notificationsOutbox.queue).toHaveBeenCalledWith(
      prisma.__tx,
      expect.objectContaining({
        recipientId: 'admin-user-1',
        eventType: 'REPORT_READY',
        entityId: 'job-1',
        // Readable fields so the notification can say WHICH report for WHICH exam.
        payload: expect.objectContaining({
          report_label: 'Attendance Report',
          session_name: 'Test Session',
          filename: 'attendance-test-session-2026-01-15.csv',
        }),
      }),
    );
  });

  it('marks the job FAILED (with an error message) when report generation throws, and does NOT notify', async () => {
    prisma.reportJob.findUnique.mockResolvedValue(pendingJob);
    prisma.attendance.findMany.mockRejectedValue(new Error('DB exploded'));

    await (service as any).process('job-1');

    expect(prisma.reportJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: ReportJobStatus.FAILED, errorMessage: 'DB exploded' },
    });
    expect(notificationsOutbox.queue).not.toHaveBeenCalled();
  });

  it('ROOM_UTILIZATION: aggregates seat usage via ONE grouped query, not one query per room (no N+1)', async () => {
    prisma.reportJob.findUnique.mockResolvedValue({ ...pendingJob, reportType: ReportType.ROOM_UTILIZATION });
    prisma.examSessionRoom.findMany.mockResolvedValue([
      { roomId: 'room-1', allocatedCapacity: 10, room: { building: 'A', roomNumber: '101', capacity: 10 } },
      { roomId: 'room-2', allocatedCapacity: 5, room: { building: 'B', roomNumber: '202', capacity: 5 } },
    ]);
    prisma.seatingAssignment.groupBy.mockResolvedValue([
      { seatId: 'seat-1', _count: 1 },
      { seatId: 'seat-2', _count: 1 },
    ]);
    prisma.roomSeat.findMany.mockResolvedValue([
      { id: 'seat-1', roomId: 'room-1' },
      { id: 'seat-2', roomId: 'room-1' },
    ]);

    await (service as any).process('job-1');

    // Exactly one groupBy call and one roomSeat.findMany call, regardless
    // of how many rooms were allocated — the N+1 pattern this test guards
    // against would instead call `roomSeat`/count queries once PER room.
    expect(prisma.seatingAssignment.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.roomSeat.findMany).toHaveBeenCalledTimes(1);

    const updateCall = prisma.__tx.reportJob.update.mock.calls[0][0];
    const csv = (updateCall.data.resultData as Buffer).toString();
    expect(csv).toContain('A-101');
    expect(csv).toContain('B-202');
  });
});
