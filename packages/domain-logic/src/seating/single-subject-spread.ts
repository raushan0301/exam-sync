import { seededRandom } from './deterministic-random';
import { SeatAssignment, SeatInput, StudentToSeatInput } from './types';

/**
 * Default placement for a room where everyone sits the SAME subject (so subject/quiz separation has
 * nothing to work with). It spreads people who are likely to know each other:
 *   - consecutive roll numbers are kept apart (they usually sit together in class),
 *   - batches alternate where there is more than one,
 *   - the pattern is staggered so front/back and diagonal neighbours are covered, not just left/right.
 *
 * 1. Sort students by (batch, natural roll number) and seat the first half on one colour of a
 *    checkerboard and the second half on the other, so every side/front/back neighbour comes from
 *    the opposite half of the list — a different batch, or roll numbers ~n/2 apart.
 * 2. A bounded, seeded local search then swaps students whenever that lowers a weighted penalty
 *    (side/front/back 12, diagonal 4, two seats away 1) x (same batch 12 + roll-number closeness up to 4),
 *    so batches alternate first and roll numbers break the tie.
 *
 * Seats are used from the front of the room (row by row); the spread only reorders people inside that
 * block. Deterministic: same seats + students + seed ⇒ same result. `seats` must be active-only.
 */
export function generateSingleSubjectSpread(
  seats: SeatInput[],
  students: StudentToSeatInput[],
  seed: string,
): { assignments: SeatAssignment[]; unseated: StudentToSeatInput[] } {
  const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const sorted = [...students].sort(
    (a, b) =>
      a.batchId.localeCompare(b.batchId) ||
      naturalCompare(a.rollNumber ?? '', b.rollNumber ?? '') ||
      a.studentId.localeCompare(b.studentId),
  );

  const seated = sorted.slice(0, seats.length);
  const unseated = sorted.slice(seats.length);
  if (seated.length === 0) {
    return { assignments: [], unseated };
  }

  // Rank of each student inside their own batch (for roll-number closeness).
  const rankById = new Map<string, number>();
  const perBatch = new Map<string, number>();
  for (const s of seated) {
    const rank = perBatch.get(s.batchId) ?? 0;
    rankById.set(s.studentId, rank);
    perBatch.set(s.batchId, rank + 1);
  }

  // Pack from the front: use only the first N seats (row by row) and spread people WITHIN that block, so a
  // half-empty room is filled A1, A2, A3... (or A1, A3, A5... with empty columns), never scattered far apart.
  const block = [...seats].sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex).slice(0, seated.length);

  // Seats as a compact grid: neighbours are the next KEPT row/column, even if the room has gaps.
  const rowRank = rankMap(block.map((s) => s.rowIndex));
  const colRank = rankMap(block.map((s) => s.colIndex));
  const ordered = block;
  const cell = (s: SeatInput) => ({ r: rowRank.get(s.rowIndex)!, c: colRank.get(s.colIndex)! });

  const colorA = ordered.filter((s) => (cell(s).r + cell(s).c) % 2 === 0);
  const colorB = ordered.filter((s) => (cell(s).r + cell(s).c) % 2 === 1);
  const slots = [...colorA, ...colorB];

  const occupant: (StudentToSeatInput | null)[] = slots.map(() => null);
  const firstHalf = Math.min(colorA.length, seated.length);
  for (let i = 0; i < seated.length; i++) {
    // First half -> colour A seats in order; the rest -> colour B seats in order.
    occupant[i < firstHalf ? i : colorA.length + (i - firstHalf)] = seated[i];
  }

  const indexByCell = new Map<string, number>();
  slots.forEach((s, i) => indexByCell.set(`${cell(s).r}:${cell(s).c}`, i));
  const NEIGHBOUR_OFFSETS: [number, number, number][] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const w = pairWeight(Math.abs(dr), Math.abs(dc));
      if (w > 0) NEIGHBOUR_OFFSETS.push([dr, dc, w]);
    }
  }
  const neighbours: [number, number][][] = slots.map((s) => {
    const { r, c } = cell(s);
    const list: [number, number][] = [];
    for (const [dr, dc, w] of NEIGHBOUR_OFFSETS) {
      const j = indexByCell.get(`${r + dr}:${c + dc}`);
      if (j !== undefined) list.push([j, w]);
    }
    return list;
  });

  const similarity = (a: StudentToSeatInput, b: StudentToSeatInput): number => {
    if (a.batchId !== b.batchId) return 0;
    // Same batch dominates (batches alternate first); roll-number closeness breaks the tie among them.
    const gap = Math.abs(rankById.get(a.studentId)! - rankById.get(b.studentId)!);
    return SAME_BATCH_COST + (gap <= 1 ? 4 : gap <= 3 ? 2 : gap <= 6 ? 1 : 0);
  };
  const seatCost = (i: number): number => {
    const a = occupant[i];
    if (!a) return 0;
    let total = 0;
    for (const [j, w] of neighbours[i]) {
      const b = occupant[j];
      if (b) total += w * similarity(a, b);
    }
    return total;
  };
  const pairCost = (i: number, j: number): number => {
    const a = occupant[i];
    const b = occupant[j];
    if (!a || !b) return 0;
    const link = neighbours[i].find(([k]) => k === j);
    return link ? link[1] * similarity(a, b) : 0;
  };
  const energy = (i: number, j: number) => seatCost(i) + seatCost(j) - pairCost(i, j);

  const rand = seededRandom(seed);
  const total = slots.length;
  const TRIES_PER_SEAT = Math.min(60, total);
  for (let pass = 0; pass < 25; pass++) {
    let improved = false;
    for (let i = 0; i < total; i++) {
      if (seatCost(i) === 0) continue;
      for (let t = 0; t < TRIES_PER_SEAT; t++) {
        const j = Math.floor(rand() * total);
        if (j === i || (!occupant[i] && !occupant[j])) continue;
        const before = energy(i, j);
        [occupant[i], occupant[j]] = [occupant[j], occupant[i]];
        if (energy(i, j) < before) {
          improved = true;
          if (seatCost(i) === 0) break;
        } else {
          [occupant[i], occupant[j]] = [occupant[j], occupant[i]];
        }
      }
    }
    if (!improved) break;
  }

  const assignments: SeatAssignment[] = [];
  slots.forEach((seat, i) => {
    const s = occupant[i];
    if (s) assignments.push({ seatId: seat.id, studentId: s.studentId, quizId: s.quizId });
  });
  return { assignments, unseated };
}

/** Cost of two neighbours sharing a batch — larger than any roll-number closeness bonus, so batches alternate first. */
const SAME_BATCH_COST = 12;

/** Penalty weight by seat offset: side/front/back 12, diagonal 4, two seats away in a line 1. */
function pairWeight(dr: number, dc: number): number {
  if (dr + dc === 1) return 12;
  if (dr === 1 && dc === 1) return 4;
  if ((dr === 0 && dc === 2) || (dr === 2 && dc === 0)) return 1;
  return 0;
}

function rankMap(values: number[]): Map<number, number> {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  return new Map(distinct.map((v, i) => [v, i]));
}

/** The seats left after skipping every second column (1st, 3rd, 5th...), counted among columns that actually have seats. */
export function keepAlternateColumns<T extends { colIndex: number }>(seats: T[]): T[] {
  const rank = rankMap(seats.map((s) => s.colIndex));
  return seats.filter((s) => rank.get(s.colIndex)! % 2 === 0);
}
