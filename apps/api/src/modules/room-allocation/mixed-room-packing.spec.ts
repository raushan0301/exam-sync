import { packMixed } from './mixed-room-packing';

const rooms = [
  { roomId: 'R2', capacity: 15 },
  { roomId: 'R1', capacity: 24 },
];
const totalIn = (placements: ReturnType<typeof packMixed>, roomId: string) =>
  placements.filter((p) => p.roomId === roomId).reduce((s, p) => s + p.count, 0);
const countOf = (placements: ReturnType<typeof packMixed>, roomId: string, quizId: string) =>
  placements.find((p) => p.roomId === roomId && p.quizId === quizId)?.count ?? 0;

describe('packMixed — every room gets a mix of every subject', () => {
  it('15 + 15 in rooms of 24 and 15: both rooms hold both subjects (not one subject per room)', () => {
    const placements = packMixed([{ quizId: 'A', count: 15 }, { quizId: 'B', count: 15 }], rooms);

    expect(countOf(placements, 'R1', 'A')).toBeGreaterThan(0);
    expect(countOf(placements, 'R1', 'B')).toBeGreaterThan(0);
    expect(countOf(placements, 'R2', 'A')).toBeGreaterThan(0);
    expect(countOf(placements, 'R2', 'B')).toBeGreaterThan(0);
    expect(totalIn(placements, 'R1') + totalIn(placements, 'R2')).toBe(30);
  });

  it('keeps every group whole in total and never overfills a room', () => {
    const groups = [{ quizId: 'A', count: 28 }, { quizId: 'B', count: 2 }, { quizId: 'C', count: 5 }];
    const placements = packMixed(groups, rooms);

    for (const g of groups) {
      expect(placements.filter((p) => p.quizId === g.quizId).reduce((s, p) => s + p.count, 0)).toBe(g.count);
    }
    expect(totalIn(placements, 'R1')).toBeLessThanOrEqual(24);
    expect(totalIn(placements, 'R2')).toBeLessThanOrEqual(15);
  });

  it('rooms are loaded in proportion to their size', () => {
    const placements = packMixed([{ quizId: 'A', count: 20 }, { quizId: 'B', count: 18 }], rooms); // 38 of 39 seats
    expect(totalIn(placements, 'R1')).toBe(23);
    expect(totalIn(placements, 'R2')).toBe(15);
  });

  it('uses as few rooms as it can: everyone fits the biggest room, so only that room is used', () => {
    const placements = packMixed([{ quizId: 'A', count: 10 }, { quizId: 'B', count: 8 }], rooms);
    expect(new Set(placements.map((p) => p.roomId))).toEqual(new Set(['R1']));
    expect(totalIn(placements, 'R1')).toBe(18);
  });

  it('a small group is still represented in every room it can reach (28 + 2)', () => {
    const placements = packMixed([{ quizId: 'A', count: 28 }, { quizId: 'B', count: 2 }], rooms);
    expect(totalIn(placements, 'R1') + totalIn(placements, 'R2')).toBe(30);
    expect(placements.filter((p) => p.quizId === 'B').reduce((s, p) => s + p.count, 0)).toBe(2);
  });

  it('is deterministic', () => {
    const groups = [{ quizId: 'A', count: 17 }, { quizId: 'B', count: 13 }];
    expect(packMixed(groups, rooms)).toEqual(packMixed(groups, rooms));
  });

  it('throws when the seats cannot cover the students', () => {
    expect(() => packMixed([{ quizId: 'A', count: 40 }], rooms)).toThrow();
  });

  it('useAllRooms keeps every given room in play instead of using the fewest', () => {
    const groups = [{ quizId: 'A', count: 10 }, { quizId: 'B', count: 8 }]; // 18 would fit the 24-seat room alone
    const fewest = packMixed(groups, rooms);
    const all = packMixed(groups, rooms, { useAllRooms: true });

    expect(new Set(fewest.map((p) => p.roomId))).toEqual(new Set(['R1']));
    expect(new Set(all.map((p) => p.roomId))).toEqual(new Set(['R1', 'R2']));
    expect(totalIn(all, 'R1') + totalIn(all, 'R2')).toBe(18);
    expect(totalIn(all, 'R2')).toBeLessThanOrEqual(15);
  });
});
