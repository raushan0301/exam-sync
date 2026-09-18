import { generateAntiCheatingPlacement } from './anti-cheating';
import { SeatInput, StudentToSeatInput } from './types';

function seat(id: string, rowIndex: number, colIndex: number, overrides: Partial<SeatInput> = {}): SeatInput {
  return { id, rowIndex, colIndex, isActive: true, isAccessible: false, ...overrides };
}

function student(id: string, quizId: string, subjectId: string, batchId: string, overrides: Partial<StudentToSeatInput> = {}): StudentToSeatInput {
  return { studentId: id, quizId, subjectId, batchId, requiresAccessibleSeat: false, ...overrides };
}

describe('generateAntiCheatingPlacement — ARCHITECTURE.md §U (Phase 14)', () => {
  describe('hand-computed small fixture (IMPLEMENTATION_PLAN.md test note: "adjacency-violation counting correctness on known small fixtures")', () => {
    // A 1x4 row: S1 S2 S3 S4 (each adjacent only to its immediate row-neighbor).
    // 2 DBMS students, 2 OS students. The only way to have ZERO adjacent
    // same-subject pairs on a 4-seat row is a strict alternation:
    // DBMS, OS, DBMS, OS (or the OS-first mirror) — every other arrangement
    // of 2+2 on a line of 4 has at least one same-subject adjacent pair.
    const row4 = [seat('S1', 0, 0), seat('S2', 0, 1), seat('S3', 0, 2), seat('S4', 0, 3)];
    const students = [
      student('dbms-1', 'q-dbms', 'DBMS', 'batch-A'),
      student('dbms-2', 'q-dbms', 'DBMS', 'batch-A'),
      student('os-1', 'q-os', 'OS', 'batch-A'),
      student('os-2', 'q-os', 'OS', 'batch-A'),
    ];

    it('produces the mathematically-optimal zero-same-subject-adjacency arrangement', () => {
      const result = generateAntiCheatingPlacement(row4, students, 'fixture-seed');

      expect(result.assignments).toHaveLength(4);
      expect(result.unseated).toEqual([]);
      expect(result.fallbackReason).toBeUndefined();

      const subjectByStudentId = new Map(students.map((s) => [s.studentId, s.subjectId]));
      const bySeat = new Map(result.assignments.map((a) => [a.seatId, subjectByStudentId.get(a.studentId)]));
      const sequence = ['S1', 'S2', 'S3', 'S4'].map((id) => bySeat.get(id));

      // Count same-subject adjacent pairs by hand: (S1,S2), (S2,S3), (S3,S4).
      let adjacentSameSubjectCount = 0;
      for (let i = 0; i < sequence.length - 1; i++) {
        if (sequence[i] === sequence[i + 1]) {
          adjacentSameSubjectCount++;
        }
      }
      expect(adjacentSameSubjectCount).toBe(0); // hand-computed expected result: a perfect alternation exists and must be found
    });

    it('is deterministic — repeated calls with the same input produce byte-identical output', () => {
      const r1 = generateAntiCheatingPlacement(row4, students, 'fixture-seed');
      const r2 = generateAntiCheatingPlacement(row4, students, 'fixture-seed');
      expect(r1).toEqual(r2);
    });
  });

  describe('greedy fill alone cannot always reach zero violations — repair pass matters', () => {
    // A 2x2 block: 4 edges total (A1-A2, A1-B1, A2-B2, B1-B2), forming a
    // 4-cycle. 3 DBMS + 1 OS: the single OS student can occupy only ONE
    // node, "clearing" at most the 2 edges touching that node (a node in a
    // 4-cycle has degree 2). The other 2 edges necessarily connect two of
    // the remaining 3 DBMS-only nodes to each other — hand-computed
    // minimum achievable is exactly 2 same-subject edges, not 0 or 1
    // (verified by exhaustively checking all 4 placements of the OS
    // student around the cycle: each leaves exactly 2 DBMS-DBMS edges
    // among the other three nodes).
    const grid2x2 = [seat('A1', 0, 0), seat('A2', 0, 1), seat('B1', 1, 0), seat('B2', 1, 1)];
    const students = [
      student('dbms-1', 'q-dbms', 'DBMS', 'batch-A'),
      student('dbms-2', 'q-dbms', 'DBMS', 'batch-A'),
      student('dbms-3', 'q-dbms', 'DBMS', 'batch-A'),
      student('os-1', 'q-os', 'OS', 'batch-A'),
    ];

    it('seats everyone, with the provably-minimal number of same-subject adjacencies (2, hand-computed)', () => {
      const result = generateAntiCheatingPlacement(grid2x2, students, 'grid-seed');

      expect(result.assignments).toHaveLength(4);
      expect(result.unseated).toEqual([]);

      const subjectByStudentId = new Map(students.map((s) => [s.studentId, s.subjectId]));
      const bySeat = new Map(result.assignments.map((a) => [a.seatId, subjectByStudentId.get(a.studentId)]));
      const edges: [string, string][] = [['A1', 'A2'], ['A1', 'B1'], ['A2', 'B2'], ['B1', 'B2']];
      const sameSubjectEdges = edges.filter(([x, y]) => bySeat.get(x) === bySeat.get(y));

      expect(sameSubjectEdges).toHaveLength(2); // hand-computed minimum for a 4-cycle with 3-of-one-label + 1-of-another (see comment above)
    });
  });

  describe('single-subject fallback chain (ARCHITECTURE.md §U step 6)', () => {
    const grid2x3 = [
      seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2),
      seat('B1', 1, 0), seat('B2', 1, 1), seat('B3', 1, 2),
    ];

    it('falls back to ALTERNATE_BATCH when only one subject is present but multiple batches exist', () => {
      const students = [
        student('a1', 'q1', 'DBMS', 'batch-A'),
        student('a2', 'q1', 'DBMS', 'batch-A'),
        student('b1', 'q1', 'DBMS', 'batch-B'),
        student('b2', 'q1', 'DBMS', 'batch-B'),
      ];

      const result = generateAntiCheatingPlacement(grid2x3, students, 'seed');

      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_ALTERNATE_BATCH');
      expect(result.assignments).toHaveLength(4);
      const batchByStudentId = new Map(students.map((s) => [s.studentId, s.batchId]));
      const sequence = result.assignments
        .sort((x, y) => x.seatId.localeCompare(y.seatId))
        .map((a) => batchByStudentId.get(a.studentId));
      expect(sequence).toEqual(['batch-A', 'batch-B', 'batch-A', 'batch-B']); // alternating, deterministic
    });

    it('falls back to CHECKERBOARD SPACING when subject AND batch are both single-valued, and capacity allows (seats >= 2x students)', () => {
      const students = [
        student('s1', 'q1', 'DBMS', 'batch-A'),
        student('s2', 'q1', 'DBMS', 'batch-A'),
      ]; // 2 students, 6 seats — plenty of room to space out

      const result = generateAntiCheatingPlacement(grid2x3, students, 'seed');

      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_CHECKERBOARD_SPACING');
      expect(result.assignments).toHaveLength(2);
      // Checkerboard pattern: (rowIndex+colIndex) even => A1(0,0)=0, A3(0,2)=2, B2(1,1)=2.
      const usedSeats = result.assignments.map((a) => a.seatId).sort();
      expect(usedSeats.every((id) => ['A1', 'A3', 'B2'].includes(id))).toBe(true);
    });

    it('falls back to pure RANDOMIZATION when subject AND batch are single-valued and checkerboard capacity is NOT available', () => {
      // 4 students in a room with only 4 seats — no room to space out (need >=8 seats for checkerboard).
      const tightRoom = [seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2), seat('A4', 0, 3)];
      const students = [
        student('s1', 'q1', 'DBMS', 'batch-A'),
        student('s2', 'q1', 'DBMS', 'batch-A'),
        student('s3', 'q1', 'DBMS', 'batch-A'),
        student('s4', 'q1', 'DBMS', 'batch-A'),
      ];

      const result = generateAntiCheatingPlacement(tightRoom, students, 'seed');

      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_RANDOMIZED');
      expect(result.assignments).toHaveLength(4);
      expect(new Set(result.assignments.map((a) => a.seatId)).size).toBe(4);
    });

    it('the fallback is deterministic and reproducible for the SAME seed', () => {
      const students = [
        student('s1', 'q1', 'DBMS', 'batch-A'),
        student('s2', 'q1', 'DBMS', 'batch-A'),
        student('s3', 'q1', 'DBMS', 'batch-A'),
        student('s4', 'q1', 'DBMS', 'batch-A'),
      ];
      const tightRoom = [seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2), seat('A4', 0, 3)];

      const r1 = generateAntiCheatingPlacement(tightRoom, students, 'same-seed');
      const r2 = generateAntiCheatingPlacement(tightRoom, students, 'same-seed');
      expect(r1).toEqual(r2);
    });

    it('never fires the fallback when the room genuinely has subject diversity', () => {
      const students = [
        student('dbms-1', 'q-dbms', 'DBMS', 'batch-A'),
        student('os-1', 'q-os', 'OS', 'batch-A'),
      ];
      const result = generateAntiCheatingPlacement(grid2x3, students, 'seed');
      expect(result.fallbackReason).toBeUndefined();
    });
  });

  describe('capacity / unseated', () => {
    it('reports leftover students as unseated, never silently dropped, when there are more students than seats', () => {
      const row2 = [seat('A1', 0, 0), seat('A2', 0, 1)];
      const students = [
        student('dbms-1', 'q1', 'DBMS', 'A'),
        student('os-1', 'q2', 'OS', 'A'),
        student('cn-1', 'q3', 'CN', 'A'),
      ];

      const result = generateAntiCheatingPlacement(row2, students, 'seed');

      expect(result.assignments).toHaveLength(2);
      expect(result.unseated).toHaveLength(1);
    });

    it('returns empty results for an empty roster, without a fallback reason', () => {
      const row2 = [seat('A1', 0, 0), seat('A2', 0, 1)];
      const result = generateAntiCheatingPlacement(row2, [], 'seed');
      expect(result).toEqual({ assignments: [], unseated: [] });
    });
  });

  describe('shared invariants', () => {
    it('never assigns two students to the same seat, or one student to two seats', () => {
      const grid = [
        seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2),
        seat('B1', 1, 0), seat('B2', 1, 1), seat('B3', 1, 2),
      ];
      const students = Array.from({ length: 6 }, (_, i) =>
        student(`s${i}`, `q${i % 3}`, `subj${i % 3}`, `batch${i % 2}`),
      );

      const result = generateAntiCheatingPlacement(grid, students, 'seed');

      const seatIds = result.assignments.map((a) => a.seatId);
      const studentIds = result.assignments.map((a) => a.studentId);
      expect(new Set(seatIds).size).toBe(seatIds.length);
      expect(new Set(studentIds).size).toBe(studentIds.length);
    });
  });
});
