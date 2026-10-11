import { SeatAssignment, SeatInput, StudentToSeatInput } from './types';

/** Cost of two same-group students sharing a side/front/back neighbour — the thing we are minimising. */
const CLASH_COST = 10;
/** Tiny pull towards the front of the room, so equal arrangements are packed from the front, never scattered. */
const FRONT_PULL = 0.001;

/**
 * Placement for the three mixing strategies (Alternate Subject / Alternate Batch / Subject + Batch Mix).
 * `keyOf` says what "the same kind" means for the strategy (quiz, batch, or subject+batch).
 *
 * 1. Greedy start: seats are filled row by row from the front; each seat takes the group that clashes
 *    least with the seat to its LEFT and the seat IN FRONT, then the group with the most students waiting.
 *    That alone makes the pattern flip from one row to the next (A B A B / B A B A) instead of repeating.
 * 2. Improvement: a bounded, deterministic local search then moves or swaps students — into any free seat
 *    of the room, too — whenever that lowers the number of same-group neighbours (left, right, front,
 *    back). This is what spreads a SMALL group evenly through the room, and what uses spare seats to keep
 *    a big group apart where the room has them; with no spare seats everyone is still seated.
 *
 * `seats` must be active-only and row-major sorted. Deterministic for the same inputs.
 */
export function generateMixedPlacement(
  seats: SeatInput[],
  students: StudentToSeatInput[],
  keyOf: (s: StudentToSeatInput) => string,
): { placed: SeatAssignment[]; leftoverStudents: StudentToSeatInput[] } {
  const canonical = [...students].sort(
    (a, b) => a.quizId.localeCompare(b.quizId) || a.studentId.localeCompare(b.studentId),
  );
  const groups = new Map<string, StudentToSeatInput[]>();
  for (const student of canonical) {
    const key = keyOf(student);
    const group = groups.get(key);
    if (group) group.push(student);
    else groups.set(key, [student]);
  }
  const groupList = [...groups.entries()].map(([key, queue]) => ({ key, queue }));

  // Neighbour lookup on the seat list: left/right = same row, front/back = same column, adjacent row.
  const rows = [...new Set(seats.map((s) => s.rowIndex))].sort((a, b) => a - b);
  const indexAt = new Map<string, number>();
  seats.forEach((s, i) => indexAt.set(`${s.rowIndex}:${s.colIndex}`, i));
  const rowBefore = new Map(rows.map((r, i) => [r, rows[i - 1]]));
  const rowAfter = new Map(rows.map((r, i) => [r, rows[i + 1]]));
  const neighbours: number[][] = seats.map((s) => {
    const list: (number | undefined)[] = [
      indexAt.get(`${s.rowIndex}:${s.colIndex - 1}`),
      indexAt.get(`${s.rowIndex}:${s.colIndex + 1}`),
      rowBefore.get(s.rowIndex) === undefined ? undefined : indexAt.get(`${rowBefore.get(s.rowIndex)}:${s.colIndex}`),
      rowAfter.get(s.rowIndex) === undefined ? undefined : indexAt.get(`${rowAfter.get(s.rowIndex)}:${s.colIndex}`),
    ];
    return list.filter((j): j is number => j !== undefined);
  });

  type Seated = { key: string; student: StudentToSeatInput };
  type Layout = (Seated | null)[];
  const total = seats.length;
  const count = Math.min(students.length, total);
  const freshQueues = () => groupList.map((g) => ({ key: g.key, queue: [...g.queue] }));

  const costOf = (layout: Layout, i: number): number => {
    const here = layout[i];
    if (!here) return 0;
    let cost = FRONT_PULL * i;
    for (const j of neighbours[i]) if (layout[j]?.key === here.key) cost += CLASH_COST;
    return cost;
  };
  const totalCost = (layout: Layout) => layout.reduce((sum, _, i) => sum + costOf(layout, i), 0);

  /** Greedy row-by-row fill. `spread` leaves a seat empty (while spare seats remain) rather than create a clash. */
  function greedyStart(spread: boolean): Layout {
    const layout: Layout = seats.map(() => null);
    const queues = freshQueues();
    let waiting = students.length;
    for (let i = 0; i < total && waiting > 0; i++) {
      const left = layout[neighbours[i].find((j) => seats[j].rowIndex === seats[i].rowIndex && j < i) ?? -1]?.key;
      const front = layout[neighbours[i].find((j) => seats[j].rowIndex !== seats[i].rowIndex && j < i) ?? -1]?.key;
      let best: (typeof queues)[number] | undefined;
      let bestClashes = Infinity;
      for (const group of queues) {
        if (group.queue.length === 0) continue;
        const clashes = (left === group.key ? 1 : 0) + (front === group.key ? 1 : 0);
        if (clashes < bestClashes || (clashes === bestClashes && best && group.queue.length > best.queue.length)) {
          best = group;
          bestClashes = clashes;
        }
      }
      if (!best) break;
      if (spread && bestClashes > 0 && total - i - 1 >= waiting) continue;
      layout[i] = { key: best.key, student: best.queue.shift()! };
      waiting -= 1;
    }
    return layout;
  }

  /** Checkerboard start: the biggest group takes one colour of the board, the rest take the other. */
  function checkerboardStart(): Layout {
    const layout: Layout = seats.map(() => null);
    const rowRank = new Map(rows.map((r, i) => [r, i]));
    const cols = [...new Set(seats.map((s) => s.colIndex))].sort((a, b) => a - b);
    const colRank = new Map(cols.map((c, i) => [c, i]));
    const color = (i: number) => ((rowRank.get(seats[i].rowIndex) ?? 0) + (colRank.get(seats[i].colIndex) ?? 0)) % 2;
    const slots = [...seats.keys()].filter((i) => color(i) === 0).concat([...seats.keys()].filter((i) => color(i) === 1));
    const ordered = freshQueues()
      .sort((a, b) => b.queue.length - a.queue.length)
      .flatMap((g) => g.queue.map((student) => ({ key: g.key, student })));
    ordered.slice(0, count).forEach((seated, k) => {
      layout[slots[k]] = seated;
    });
    return layout;
  }

  /** Bounded, deterministic local search: swap or move students (into free seats too) while it lowers the cost. */
  function improve(layout: Layout): Layout {
    const clashesAt = (i: number): number => neighbours[i].filter((j) => layout[j]?.key === layout[i]?.key).length;
    const sharedPair = (i: number, j: number): number =>
      neighbours[i].includes(j) && layout[i] && layout[j] && layout[i]!.key === layout[j]!.key ? CLASH_COST : 0;
    const energy = (i: number, j: number) => costOf(layout, i) + costOf(layout, j) - sharedPair(i, j);
    for (let pass = 0; pass < 20; pass++) {
      let improved = false;
      for (let i = 0; i < total; i++) {
        if (!layout[i] || clashesAt(i) === 0) continue;
        for (let j = 0; j < total; j++) {
          if (j === i || (!layout[j] && !layout[i]) || layout[j]?.key === layout[i]?.key) continue;
          const before = energy(i, j);
          [layout[i], layout[j]] = [layout[j], layout[i]];
          if (energy(i, j) < before - 1e-9) {
            improved = true;
            break; // seat i now holds someone else — move on
          }
          [layout[i], layout[j]] = [layout[j], layout[i]];
        }
      }
      if (!improved) break;
    }
    return layout;
  }

  // Several starting points; keep the best result (ties keep the earlier, more compact one).
  let occupant: Layout = improve(greedyStart(false));
  for (const start of [greedyStart(true), checkerboardStart()]) {
    const candidate = improve(start);
    if (totalCost(candidate) < totalCost(occupant) - 1e-9) occupant = candidate;
  }
  const seatedIds = new Set(occupant.filter((o): o is Seated => o !== null).map((o) => o.student.studentId));
  const leftoverStudents = canonical.filter((s) => !seatedIds.has(s.studentId));

  const placed: SeatAssignment[] = [];
  occupant.forEach((o, i) => {
    if (o) placed.push({ seatId: seats[i].id, studentId: o.student.studentId, quizId: o.student.quizId });
  });
  return { placed, leftoverStudents };
}
