import { buildIncidentReportTable } from './incident-report';

describe('buildIncidentReportTable', () => {
  it('renders a fully-populated incident row', () => {
    const table = buildIncidentReportTable([
      {
        incidentType: 'CHEATING_SUSPICION',
        severity: 'HIGH',
        status: 'RESOLVED',
        description: 'Observed copying',
        reportedByFaculty: { name: 'Dr. Smith' },
        student: { name: 'Ada', rollNumber: 'R1' },
        room: { building: 'A', roomNumber: '101' },
        seat: { seatLabel: 'A1' },
        resolution: 'Verified false alarm',
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);

    expect(table.rows[0]).toEqual([
      'CHEATING_SUSPICION',
      'HIGH',
      'RESOLVED',
      'Observed copying',
      'Dr. Smith',
      'R1',
      'Ada',
      'A-101',
      'A1',
      'Verified false alarm',
      '2026-01-01T10:00:00.000Z',
    ]);
  });

  it('renders empty strings for every optional/nullable field when absent', () => {
    const table = buildIncidentReportTable([
      {
        incidentType: 'TECHNICAL',
        severity: 'LOW',
        status: 'OPEN',
        description: 'Projector issue',
        reportedByFaculty: { name: 'Dr. Lee' },
        student: null,
        room: null,
        seat: null,
        resolution: null,
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);

    expect(table.rows[0]).toEqual([
      'TECHNICAL',
      'LOW',
      'OPEN',
      'Projector issue',
      'Dr. Lee',
      '',
      '',
      '',
      '',
      '',
      '2026-01-01T10:00:00.000Z',
    ]);
  });
});
