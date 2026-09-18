import { buildRoomUtilizationReportTable } from './room-utilization-report';

describe('buildRoomUtilizationReportTable', () => {
  it('computes utilization % against the room\'s own total seat capacity', () => {
    const table = buildRoomUtilizationReportTable([
      { room: { building: 'A', roomNumber: '101', capacity: 40 }, allocatedCapacity: 30, seatsUsed: 27 },
    ]);

    expect(table.rows[0]).toEqual(['A-101', 40, 30, 27, 67.5]);
  });

  it('rounds to one decimal place', () => {
    const table = buildRoomUtilizationReportTable([
      { room: { building: 'A', roomNumber: '101', capacity: 3 }, allocatedCapacity: 3, seatsUsed: 1 },
    ]);
    expect(table.rows[0][4]).toBe(33.3);
  });

  it('does not divide by zero for a room with 0 capacity — reports 0% instead of NaN/Infinity', () => {
    const table = buildRoomUtilizationReportTable([
      { room: { building: 'A', roomNumber: '101', capacity: 0 }, allocatedCapacity: 0, seatsUsed: 0 },
    ]);
    expect(table.rows[0][4]).toBe(0);
  });

  it('produces one row per allocated room, independently', () => {
    const table = buildRoomUtilizationReportTable([
      { room: { building: 'A', roomNumber: '101', capacity: 10 }, allocatedCapacity: 10, seatsUsed: 10 },
      { room: { building: 'B', roomNumber: '202', capacity: 20 }, allocatedCapacity: 5, seatsUsed: 0 },
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][4]).toBe(100);
    expect(table.rows[1][4]).toBe(0);
  });
});
