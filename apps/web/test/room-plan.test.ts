import { describe, expect, it } from 'vitest';
import { buildCustomPlan, differsFromPlan } from '@/lib/room-plan';
import type { AvailableRoomOption } from '@/lib/queries/types';

const room = (roomId: string, roomNumber: string, capacity: number, over: Partial<AvailableRoomOption> = {}): AvailableRoomOption => ({
  roomId,
  building: 'B',
  floor: 0,
  roomNumber,
  capacity,
  ...over,
});
const pool = [room('a', '107', 21), room('b', '301', 32, { floor: 3 }), room('c', '208', 31, { floor: 2 })];

describe('buildCustomPlan', () => {
  it('Fewest Classes fills each picked room to the brim in floor order', () => {
    const plan = buildCustomPlan('FEWEST_ROOMS', ['b', 'a'], pool, 30);
    expect(plan.rooms.map((r) => [r.roomNumber, r.allocated, r.capacity])).toEqual([['107', 21, 21], ['301', 9, 32]]);
    expect(plan.roomCount).toBe(2);
    expect(plan.totalCapacity).toBe(53);
    expect(plan.utilizationPercent).toBe(57);
    expect(plan.location).toBe('Building B · floors 0, 3');
  });

  it('Balanced Spread gives every picked room an equal share, the remainder one by one', () => {
    const plan = buildCustomPlan('BALANCED_SPREAD', ['a', 'b', 'c'], pool, 10);
    expect(plan.rooms.map((r) => r.allocated)).toEqual([4, 3, 3]);
  });

  it('caps a balanced share at the room\'s own seats and gives the rest to roomier rooms', () => {
    const plan = buildCustomPlan('BALANCED_SPREAD', ['a', 'b'], [room('a', '1', 2), room('b', '2', 40, { floor: 1 })], 20);
    expect(plan.rooms.map((r) => r.allocated)).toEqual([2, 18]);
  });

  it('is empty when nothing is picked, and ignores rooms that are not in the pool', () => {
    expect(buildCustomPlan('FEWEST_ROOMS', [], pool, 10)).toMatchObject({ roomCount: 0, totalCapacity: 0, utilizationPercent: 0, location: '' });
    expect(buildCustomPlan('FEWEST_ROOMS', ['gone', 'a'], pool, 10).rooms.map((r) => r.roomId)).toEqual(['a']);
  });

  it('carries the "shared with another quiz" info onto the picked room', () => {
    const shared = [{ quizId: 'q', quizTitle: 'Quiz C', seats: 1 }];
    const plan = buildCustomPlan('FEWEST_ROOMS', ['a'], [room('a', '107', 21, { sharedWith: shared })], 5);
    expect(plan.rooms[0].sharedWith).toEqual(shared);
  });
});

describe('differsFromPlan', () => {
  it('ignores order but notices an added, removed or swapped room', () => {
    expect(differsFromPlan(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(differsFromPlan(['a'], ['a', 'b'])).toBe(true);
    expect(differsFromPlan(['a', 'b'], ['a'])).toBe(true);
    expect(differsFromPlan(['a'], ['c'])).toBe(true);
    expect(differsFromPlan([], [])).toBe(false);
  });
});
