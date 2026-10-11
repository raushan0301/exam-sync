import { generateSingleSubjectSpread, keepAlternateColumns } from './single-subject-spread';
import { SeatInput, StudentToSeatInput } from './types';

function seat(id: string, rowIndex: number, colIndex: number): SeatInput {
  return { id, rowIndex, colIndex, isActive: true, isAccessible: false };
}

function student(id: string, batchId: string, rollNumber?: string): StudentToSeatInput {
  return { studentId: id, quizId: 'q1', subjectId: 'DBMS', batchId, rollNumber, requiresAccessibleSeat: false };
}

function grid(rows: number, cols: number): SeatInput[] {
  return Array.from({ length: rows * cols }, (_, i) => seat(`S${i}`, Math.floor(i / cols), i % cols));
}

const grid2x3 = grid(2, 3);
const adjacent = (a: SeatInput, b: SeatInput) => Math.abs(a.rowIndex - b.rowIndex) + Math.abs(a.colIndex - b.colIndex) === 1;

describe('generateSingleSubjectSpread — one-subject rooms', () => {
  it('several batches: same-batch students never sit on neighbouring seats', () => {
    const students = [student('a1', 'A', '1'), student('a2', 'A', '2'), student('b1', 'B', '1'), student('b2', 'B', '2')];

    const { assignments } = generateSingleSubjectSpread(grid2x3, students, 'seed');

    const batchOf = new Map(students.map((s) => [s.studentId, s.batchId]));
    const seatOf = new Map(grid2x3.map((s) => [s.id, s]));
    expect(assignments).toHaveLength(4);
    for (const x of assignments) {
      for (const y of assignments) {
        if (x !== y && adjacent(seatOf.get(x.seatId)!, seatOf.get(y.seatId)!)) {
          expect(batchOf.get(x.studentId)).not.toBe(batchOf.get(y.studentId));
        }
      }
    }
  });

  it('spare seats: people are packed from the front, never scattered across the room', () => {
    const seats = grid(6, 7);
    const students = [student('s1', 'A', '1'), student('s2', 'A', '2'), student('s3', 'A', '3')];

    const { assignments } = generateSingleSubjectSpread(seats, students, 'seed');

    expect(assignments.map((a) => a.seatId).sort()).toEqual(['S0', 'S1', 'S2']); // A1, A2, A3
  });

  it('with empty columns kept, packs into the nearest kept seats (A1, A3, A5...), not A1 and A7', () => {
    const kept = keepAlternateColumns(grid(6, 7)); // columns 0,2,4,6
    const { assignments } = generateSingleSubjectSpread(kept, [student('s1', 'A', '1'), student('s2', 'A', '2')], 'seed');

    expect(assignments.map((a) => a.seatId).sort()).toEqual(['S0', 'S2']); // A1 and A3
  });

  it('one batch, full 10x10 room: consecutive roll numbers never sit side by side, front/back or diagonally', () => {
    const seats = grid(10, 10);
    const students = seats.map((_, i) => student(`st${i}`, 'A', String(i + 1)));

    const { assignments, unseated } = generateSingleSubjectSpread(seats, students, 'seed');

    expect(unseated).toHaveLength(0);
    const rollOf = new Map(students.map((s) => [s.studentId, Number(s.rollNumber)]));
    const seatOf = new Map(seats.map((s) => [s.id, s]));
    for (const x of assignments) {
      for (const y of assignments) {
        const sx = seatOf.get(x.seatId)!;
        const sy = seatOf.get(y.seatId)!;
        const near = Math.max(Math.abs(sx.rowIndex - sy.rowIndex), Math.abs(sx.colIndex - sy.colIndex)) === 1;
        if (x !== y && near) {
          expect(Math.abs(rollOf.get(x.studentId)! - rollOf.get(y.studentId)!)).toBeGreaterThan(2);
        }
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const students = Array.from({ length: 8 }, (_, i) => student(`s${i}`, 'A', String(i + 1)));
    const seats = grid(3, 4);
    expect(generateSingleSubjectSpread(seats, students, 'same')).toEqual(generateSingleSubjectSpread(seats, students, 'same'));
  });

  it('reports students that do not fit as unseated instead of dropping them', () => {
    const students = Array.from({ length: 5 }, (_, i) => student(`s${i}`, 'A', String(i + 1)));
    const { assignments, unseated } = generateSingleSubjectSpread(grid(1, 3), students, 'seed');
    expect(assignments).toHaveLength(3);
    expect(unseated).toHaveLength(2);
  });
});

describe('generateSingleSubjectSpread — batches alternate first', () => {
  function sameBatchNeighbours(seats: SeatInput[], students: StudentToSeatInput[], assignments: { seatId: string; studentId: string }[]) {
    const batchOf = new Map(students.map((s) => [s.studentId, s.batchId]));
    const seatOf = new Map(seats.map((s) => [s.id, s]));
    let count = 0;
    for (const x of assignments) {
      for (const y of assignments) {
        if (x.seatId < y.seatId && adjacent(seatOf.get(x.seatId)!, seatOf.get(y.seatId)!) && batchOf.get(x.studentId) === batchOf.get(y.studentId)) count += 1;
      }
    }
    return count;
  }

  it.each([2, 3])('%i batches of equal size: no two same-batch students are side by side or front/back', (batches) => {
    const seats = grid(4, 6);
    const students = Array.from({ length: 12 }, (_, i) => student(`s${i}`, `B${i % batches}`, String(Math.floor(i / batches) + 1)));

    const { assignments } = generateSingleSubjectSpread(seats, students, 'seed');

    expect(sameBatchNeighbours(seats, students, assignments)).toBe(0);
  });
});

describe('keepAlternateColumns', () => {
  it('keeps the 1st, 3rd, 5th... columns that actually have seats', () => {
    expect(keepAlternateColumns(grid(2, 5)).map((s) => s.colIndex)).toEqual([0, 2, 4, 0, 2, 4]);
  });

  it('counts columns by rank, so a room with a missing column still alternates', () => {
    const seats = [seat('a', 0, 0), seat('b', 0, 2), seat('c', 0, 3)];
    expect(keepAlternateColumns(seats).map((s) => s.id)).toEqual(['a', 'c']);
  });
});
