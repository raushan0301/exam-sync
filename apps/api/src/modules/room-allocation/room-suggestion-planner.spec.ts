import { describeLocation, fewestRoomsPlan, nearestToExistingPlan, PoolRoom, spreadEvenly, togetherPlan } from './room-suggestion-planner';

const room = (building: string, floor: number, roomNumber: string, capacity: number): PoolRoom => ({
  roomId: `${building}-${roomNumber}`,
  building,
  floor,
  roomNumber,
  capacity,
});
const ids = (plan: { rooms: { roomId: string }[] }) => plan.rooms.map((r) => r.roomId);

describe('togetherPlan — stay in one building, fill each floor before the next', () => {
  it('uses one building that can hold everyone, filling the ground floor before the first floor', () => {
    const pool = [
      room('B', 1, 'B-201', 40),
      room('B', 0, 'B-101', 30),
      room('B', 0, 'B-102', 30),
      room('B', 1, 'B-202', 40),
      room('C', 0, 'C-101', 200),
    ];

    const plan = togetherPlan(pool, 70);

    // Building C alone would need 1 room, so it is picked as the building that needs the fewest rooms…
    expect(ids(plan)).toEqual(['C-C-101']);
    expect(plan.spansBuildings).toBe(false);
  });

  it('walks the floors from the ground up, using a whole floor before touching the next', () => {
    const pool = [room('B', 2, 'B-301', 50), room('B', 0, 'B-101', 20), room('B', 0, 'B-102', 25), room('B', 1, 'B-201', 30)];

    const plan = togetherPlan(pool, 60);

    // Ground floor (25 + 20) first, then floor 1 (30) — floor 2's big room is not skipped to.
    expect(ids(plan)).toEqual(['B-B-102', 'B-B-101', 'B-B-201']);
    expect(plan.rooms.map((r) => r.allocated)).toEqual([25, 20, 15]);
    expect(plan.location).toBe('Building B · floors 0–1');
  });

  it('prefers the building that needs the fewest rooms, then the fewest floors, then the name', () => {
    const pool = [
      room('A', 0, 'A-1', 30), room('A', 1, 'A-2', 30), room('A', 2, 'A-3', 30),
      room('B', 0, 'B-1', 45), room('B', 0, 'B-2', 45),
      room('C', 0, 'C-1', 45), room('C', 0, 'C-2', 45),
    ];

    const plan = togetherPlan(pool, 80);

    expect(new Set(plan.rooms.map((r) => r.building))).toEqual(new Set(['B'])); // 2 rooms on one floor beats A's 3 rooms; B before C by name
  });

  it('spans buildings only when no single building is big enough, biggest building first', () => {
    const pool = [room('A', 0, 'A-1', 30), room('B', 0, 'B-1', 50), room('B', 1, 'B-2', 20), room('C', 0, 'C-1', 25)];

    const plan = togetherPlan(pool, 90);

    expect(plan.spansBuildings).toBe(true);
    expect(ids(plan)).toEqual(['B-B-1', 'B-B-2', 'A-A-1']);
    expect(plan.location).toBe('Building B · floors 0–1 + Building A · floor 0');
  });

  it('places everyone it can and returns every room when even all rooms together fall short', () => {
    const plan = togetherPlan([room('A', 0, 'A-1', 10), room('B', 0, 'B-1', 5)], 100);
    expect(plan.rooms.reduce((s, r) => s + r.allocated, 0)).toBe(15);
  });

  it('is deterministic and ignores rooms with no usable seats', () => {
    const pool = [room('B', 0, 'B-101', 0), room('B', 0, 'B-102', 30)];
    expect(ids(togetherPlan(pool, 20))).toEqual(['B-B-102']);
    expect(togetherPlan(pool, 20)).toEqual(togetherPlan([...pool].reverse(), 20));
  });
});

describe('fewestRoomsPlan — biggest rooms first, wherever they are', () => {
  it('needs fewer rooms than staying together when the big rooms sit in different buildings', () => {
    const pool = [
      room('B', 0, 'B-101', 25), room('B', 0, 'B-102', 25), room('B', 1, 'B-201', 25), // only building B alone can hold 70
      room('C', 0, 'C-101', 40),
      room('D', 0, 'D-101', 40),
    ];

    const fewest = fewestRoomsPlan(pool, 70);
    const together = togetherPlan(pool, 70);

    expect(ids(fewest)).toEqual(['C-C-101', 'D-D-101']);
    expect(fewest.spansBuildings).toBe(true);
    expect(together.rooms).toHaveLength(3); // the conflict the person is asked about: 3 rooms in one building vs 2 rooms in two
    expect(together.spansBuildings).toBe(false);
  });
});

describe('spreadEvenly', () => {
  it('spreads students across the same rooms, capped at each room\'s size', () => {
    const plan = togetherPlan([room('B', 0, 'B-1', 40), room('B', 0, 'B-2', 10)], 45);

    const spread = spreadEvenly(plan, 45);

    expect(spread.rooms.map((r) => r.allocated)).toEqual([35, 10]);
    expect(spread.rooms.reduce((s, r) => s + r.allocated, 0)).toBe(45);
  });

  it('gives an equal share when every room is big enough', () => {
    const plan = togetherPlan([room('B', 0, 'B-1', 40), room('B', 0, 'B-2', 40)], 60);
    expect(spreadEvenly(plan, 60).rooms.map((r) => r.allocated)).toEqual([30, 30]);
  });
});

describe('describeLocation', () => {
  it('names a single floor, a contiguous run and a gap', () => {
    expect(describeLocation([room('B', 2, 'x', 1)])).toBe('Building B · floor 2');
    expect(describeLocation([room('B', 0, 'x', 1), room('B', 1, 'y', 1)])).toBe('Building B · floors 0–1');
    expect(describeLocation([room('B', 0, 'x', 1), room('B', 2, 'y', 1)])).toBe('Building B · floors 0, 2');
  });
});

describe('nearestToExistingPlan — extra rooms next to the rooms already in use', () => {
  const existing = [{ building: 'B', floor: 1 }];

  it('takes the same floor first, then the nearest floor of that building, then other buildings', () => {
    const pool = [
      room('C', 1, 'C-101', 100), // other building
      room('B', 3, 'B-301', 30), // same building, 2 floors away
      room('B', 2, 'B-201', 30), // same building, 1 floor away
      room('B', 1, 'B-102', 30), // same floor
    ];

    expect(ids(nearestToExistingPlan(pool, existing, 100))).toEqual(['B-B-102', 'B-B-201', 'B-B-301', 'C-C-101']);
  });

  it('stops as soon as the needed seats are covered', () => {
    const pool = [room('B', 1, 'B-102', 30), room('B', 1, 'B-103', 30), room('B', 2, 'B-201', 30)];
    const plan = nearestToExistingPlan(pool, existing, 40);
    expect(ids(plan)).toEqual(['B-B-102', 'B-B-103']);
    expect(plan.rooms.map((r) => r.allocated)).toEqual([30, 10]);
  });

  it('within a tier: the biggest room first, ground floor before higher on equal distance', () => {
    const pool = [room('B', 2, 'B-201', 20), room('B', 0, 'B-001', 20), room('B', 1, 'B-102', 10), room('B', 1, 'B-103', 40)];
    expect(ids(nearestToExistingPlan(pool, existing, 90))).toEqual(['B-B-103', 'B-B-102', 'B-B-001', 'B-B-201']);
  });

  it('needs nothing when no extra seats are needed', () => {
    expect(nearestToExistingPlan([room('B', 1, 'B-102', 30)], existing, 0).rooms).toEqual([]);
  });
});
