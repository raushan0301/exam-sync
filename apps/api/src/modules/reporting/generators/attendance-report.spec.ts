import { buildAttendanceReportTable } from './attendance-report';

describe('buildAttendanceReportTable', () => {
  it('produces one row per attendance record with the expected columns', () => {
    const table = buildAttendanceReportTable([
      {
        quizStudentAssignment: { student: { name: 'Ada', rollNumber: 'R1' }, quiz: { title: 'DBMS' } },
        seat: { seatLabel: 'A1' },
        status: 'PRESENT',
        method: 'SEAT_BASED',
        markedAt: new Date('2026-01-01T10:00:00Z'),
        locked: false,
      },
    ]);

    expect(table.headers).toEqual([
      'Roll Number',
      'Student Name',
      'Quiz',
      'Seat',
      'Status',
      'Method',
      'Marked At',
      'Locked',
    ]);
    expect(table.rows).toEqual([['R1', 'Ada', 'DBMS', 'A1', 'PRESENT', 'SEAT_BASED', '2026-01-01T10:00:00.000Z', 'No']]);
  });

  it('renders locked as "Yes" and a missing seat as an empty string', () => {
    const table = buildAttendanceReportTable([
      {
        quizStudentAssignment: { student: { name: 'Bob', rollNumber: 'R2' }, quiz: { title: 'OS' } },
        seat: null,
        status: 'ABSENT',
        method: 'MANUAL',
        markedAt: new Date('2026-01-01T10:05:00Z'),
        locked: true,
      },
    ]);

    expect(table.rows[0][3]).toBe('');
    expect(table.rows[0][7]).toBe('Yes');
  });

  it('returns an empty rows array for no attendance (deterministic empty-result handling)', () => {
    expect(buildAttendanceReportTable([]).rows).toEqual([]);
  });
});
