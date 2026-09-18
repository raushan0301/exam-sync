import { buildSeatingPlanReportTable } from './seating-plan-report';

describe('buildSeatingPlanReportTable', () => {
  it('flattens assignments across MULTIPLE rooms\' plans into one row set', () => {
    const table = buildSeatingPlanReportTable([
      {
        status: 'FINALIZED',
        room: { building: 'A', roomNumber: '101' },
        assignments: [
          { seat: { seatLabel: 'A1' }, student: { name: 'Ada', rollNumber: 'R1' }, quiz: { title: 'DBMS' } },
          { seat: { seatLabel: 'A2' }, student: { name: 'Bob', rollNumber: 'R2' }, quiz: { title: 'DBMS' } },
        ],
      },
      {
        status: 'FINALIZED',
        room: { building: 'B', roomNumber: '202' },
        assignments: [
          { seat: { seatLabel: 'B1' }, student: { name: 'Cy', rollNumber: 'R3' }, quiz: { title: 'OS' } },
        ],
      },
    ]);

    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]).toEqual(['A-101', 'A1', 'R1', 'Ada', 'DBMS', 'FINALIZED']);
    expect(table.rows[2]).toEqual(['B-202', 'B1', 'R3', 'Cy', 'OS', 'FINALIZED']);
  });

  it('returns no rows for a plan with zero assignments', () => {
    const table = buildSeatingPlanReportTable([
      { status: 'DRAFT', room: { building: 'A', roomNumber: '101' }, assignments: [] },
    ]);
    expect(table.rows).toEqual([]);
  });

  it('returns no rows when the session has no seating plans at all', () => {
    expect(buildSeatingPlanReportTable([]).rows).toEqual([]);
  });
});
