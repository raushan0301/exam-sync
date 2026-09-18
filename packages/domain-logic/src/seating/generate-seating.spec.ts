import { generateSeating } from './generate-seating';
import { SeatingStrategyName, SeatInput, StudentToSeatInput } from './types';

function seat(id: string, rowIndex: number, colIndex: number, overrides: Partial<SeatInput> = {}): SeatInput {
  return { id, rowIndex, colIndex, isActive: true, isAccessible: false, ...overrides };
}

function student(id: string, quizId: string, subjectId: string, batchId: string, overrides: Partial<StudentToSeatInput> = {}): StudentToSeatInput {
  return { studentId: id, quizId, subjectId, batchId, requiresAccessibleSeat: false, ...overrides };
}

// A 2x3 room: A1 A2 A3 / B1 B2 B3
const grid2x3: SeatInput[] = [
  seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2),
  seat('B1', 1, 0), seat('B2', 1, 1), seat('B3', 1, 2),
];

describe('generateSeating — pure, deterministic (Phase 13)', () => {
  describe('SEQUENTIAL', () => {
    it('fills seats in row-major order using canonical (quizId, studentId) student order', () => {
      const students = [
        student('s3', 'q1', 'DBMS', 'A'),
        student('s1', 'q1', 'DBMS', 'A'),
        student('s2', 'q1', 'DBMS', 'A'),
      ];

      const result = generateSeating({ seats: grid2x3, students, strategy: 'SEQUENTIAL' });

      expect(result.assignments.map((a) => [a.seatId, a.studentId])).toEqual([
        ['A1', 's1'], ['A2', 's2'], ['A3', 's3'],
      ]);
      expect(result.unseated).toEqual([]);
    });

    it('is deterministic: repeated calls with the same input produce byte-identical output', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q2', 'OS', 'B')];
      const r1 = generateSeating({ seats: grid2x3, students, strategy: 'SEQUENTIAL' });
      const r2 = generateSeating({ seats: grid2x3, students, strategy: 'SEQUENTIAL' });
      expect(r1).toEqual(r2);
    });
  });

  describe('RANDOMIZED — reproducibility via seed', () => {
    const students = Array.from({ length: 6 }, (_, i) => student(`s${i}`, 'q1', 'DBMS', 'A'));

    it('produces the SAME assignment for the SAME seed, every time', () => {
      const r1 = generateSeating({ seats: grid2x3, students, strategy: 'RANDOMIZED', seed: 'session-1:room-1' });
      const r2 = generateSeating({ seats: grid2x3, students, strategy: 'RANDOMIZED', seed: 'session-1:room-1' });
      expect(r1).toEqual(r2);
    });

    it('produces a DIFFERENT (or at least not guaranteed-identical) placement for a different seed', () => {
      const r1 = generateSeating({ seats: grid2x3, students, strategy: 'RANDOMIZED', seed: 'seed-a' });
      const r2 = generateSeating({ seats: grid2x3, students, strategy: 'RANDOMIZED', seed: 'seed-b' });
      // Not a strict guarantee for any PRNG, but for these seeds+inputs the orders differ — pins actual behavior.
      expect(r1.assignments).not.toEqual(r2.assignments);
    });

    it('still seats every student — a shuffle, not a lossy operation', () => {
      const result = generateSeating({ seats: grid2x3, students, strategy: 'RANDOMIZED', seed: 'x' });
      expect(result.assignments).toHaveLength(6);
      expect(result.unseated).toEqual([]);
      expect(new Set(result.assignments.map((a) => a.seatId)).size).toBe(6);
    });
  });

  describe('ALTERNATE_SUBJECT — round-robin by quiz', () => {
    it('interleaves two quiz groups rather than placing them in contiguous blocks', () => {
      const students = [
        student('dbms-1', 'q-dbms', 'DBMS', 'A'),
        student('dbms-2', 'q-dbms', 'DBMS', 'A'),
        student('dbms-3', 'q-dbms', 'DBMS', 'A'),
        student('os-1', 'q-os', 'OS', 'A'),
        student('os-2', 'q-os', 'OS', 'A'),
        student('os-3', 'q-os', 'OS', 'A'),
      ];

      const result = generateSeating({ seats: grid2x3, students, strategy: 'ALTERNATE_SUBJECT' });
      const quizSequence = result.assignments.map((a) => a.quizId);

      // Round-robin over 2 equal-size groups => strictly alternating.
      expect(quizSequence).toEqual(['q-dbms', 'q-os', 'q-dbms', 'q-os', 'q-dbms', 'q-os']);
    });
  });

  describe('ALTERNATE_BATCH — round-robin by batch', () => {
    it('interleaves two batch groups', () => {
      const students = [
        student('a1', 'q1', 'DBMS', 'batch-A'),
        student('a2', 'q1', 'DBMS', 'batch-A'),
        student('b1', 'q1', 'DBMS', 'batch-B'),
        student('b2', 'q1', 'DBMS', 'batch-B'),
      ];

      const result = generateSeating({ seats: grid2x3, students, strategy: 'ALTERNATE_BATCH' });
      const batchSequence = result.assignments.map((a) => {
        const s = students.find((st) => st.studentId === a.studentId)!;
        return s.batchId;
      });

      expect(batchSequence).toEqual(['batch-A', 'batch-B', 'batch-A', 'batch-B']);
    });
  });

  describe('SUBJECT_BATCH_MIX — round-robin by composite (subject, batch)', () => {
    it('interleaves across the composite key, not just one dimension', () => {
      const students = [
        student('x1', 'q1', 'DBMS', 'batch-A'),
        student('x2', 'q1', 'DBMS', 'batch-A'),
        student('y1', 'q2', 'DBMS', 'batch-B'),
        student('y2', 'q2', 'DBMS', 'batch-B'),
      ];

      const result = generateSeating({ seats: grid2x3, students, strategy: 'SUBJECT_BATCH_MIX' });
      const groupSequence = result.assignments.map((a) => {
        const s = students.find((st) => st.studentId === a.studentId)!;
        return `${s.subjectId}::${s.batchId}`;
      });

      expect(groupSequence).toEqual(['DBMS::batch-A', 'DBMS::batch-B', 'DBMS::batch-A', 'DBMS::batch-B']);
    });
  });

  describe('ANTI_CHEATING — dispatch integration (Phase 14)', () => {
    it('is routed to the anti-cheating placement, not the orderStudents+zip pipeline (interleaves subjects, unlike SEQUENTIAL)', () => {
      const students = [
        student('dbms-1', 'q-dbms', 'DBMS', 'A'),
        student('dbms-2', 'q-dbms', 'DBMS', 'A'),
        student('os-1', 'q-os', 'OS', 'A'),
        student('os-2', 'q-os', 'OS', 'A'),
      ];
      const row4 = [seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2), seat('A4', 0, 3)];

      const result = generateSeating({ seats: row4, students, strategy: 'ANTI_CHEATING', seed: 'x' });

      expect(result.assignments).toHaveLength(4);
      expect(result.fallbackReason).toBeUndefined();
      const subjectByStudentId = new Map(students.map((s) => [s.studentId, s.subjectId]));
      const sequence = result.assignments
        .slice()
        .sort((a, b) => a.seatId.localeCompare(b.seatId))
        .map((a) => subjectByStudentId.get(a.studentId));
      expect(sequence).toEqual(['DBMS', 'OS', 'DBMS', 'OS']); // alternating — the achievable optimum on a 4-seat line
    });

    it('still respects the accessibility pre-pass (BR-028) ahead of anti-cheating placement', () => {
      const seatsWithOneAccessible = [seat('A1', 0, 0), seat('A2', 0, 1, { isAccessible: true }), seat('A3', 0, 2)];
      const students = [
        student('needs-access', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true }),
        student('other-1', 'q2', 'OS', 'A'),
        student('other-2', 'q1', 'DBMS', 'A'),
      ];

      const result = generateSeating({ seats: seatsWithOneAccessible, students, strategy: 'ANTI_CHEATING', seed: 'x' });

      const accessRow = result.assignments.find((a) => a.studentId === 'needs-access');
      expect(accessRow?.seatId).toBe('A2');
    });

    it('surfaces the single-subject fallback reason through the top-level generateSeating call', () => {
      const students = [
        student('s1', 'q1', 'DBMS', 'A'),
        student('s2', 'q1', 'DBMS', 'A'),
        student('s3', 'q1', 'DBMS', 'A'),
      ];
      const row3 = [seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2)]; // no room to checkerboard

      const result = generateSeating({ seats: row3, students, strategy: 'ANTI_CHEATING', seed: 'x' });

      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_RANDOMIZED');
    });
  });

  describe('every strategy, shared invariants', () => {
    const strategies: SeatingStrategyName[] = ['SEQUENTIAL', 'RANDOMIZED', 'ALTERNATE_SUBJECT', 'ALTERNATE_BATCH', 'SUBJECT_BATCH_MIX', 'ANTI_CHEATING'];

    it.each(strategies)('%s never assigns two students to the same seat', (strategy) => {
      const students = Array.from({ length: 6 }, (_, i) => student(`s${i}`, `q${i % 2}`, `subj${i % 3}`, `batch${i % 2}`));
      const result = generateSeating({ seats: grid2x3, students, strategy, seed: 'fixed-seed' });

      const seatIds = result.assignments.map((a) => a.seatId);
      expect(new Set(seatIds).size).toBe(seatIds.length);
    });

    it.each(strategies)('%s never assigns a student to more than one seat', (strategy) => {
      const students = Array.from({ length: 6 }, (_, i) => student(`s${i}`, `q${i % 2}`, `subj${i % 3}`, `batch${i % 2}`));
      const result = generateSeating({ seats: grid2x3, students, strategy, seed: 'fixed-seed' });

      const studentIds = result.assignments.map((a) => a.studentId);
      expect(new Set(studentIds).size).toBe(studentIds.length);
    });
  });

  describe('inactive seats are never used', () => {
    it('skips a disabled seat entirely, using only active ones', () => {
      const seatsWithOneDisabled = [seat('A1', 0, 0), seat('A2', 0, 1, { isActive: false }), seat('A3', 0, 2)];
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];

      const result = generateSeating({ seats: seatsWithOneDisabled, students, strategy: 'SEQUENTIAL' });

      expect(result.assignments.map((a) => a.seatId).sort()).toEqual(['A1', 'A3']);
      expect(result.unseated).toEqual([]);
    });
  });

  describe('accessibility (BR-028): accessibility-required students placed only in accessible seats', () => {
    it('places an accessibility-required student in the accessible seat, even out of the strategy\'s natural order', () => {
      const seatsWithOneAccessible = [
        seat('A1', 0, 0), seat('A2', 0, 1, { isAccessible: true }), seat('A3', 0, 2),
      ];
      const students = [
        student('needs-access', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true }),
        student('s-other-1', 'q1', 'DBMS', 'A'),
        student('s-other-2', 'q1', 'DBMS', 'A'),
      ];

      const result = generateSeating({ seats: seatsWithOneAccessible, students, strategy: 'SEQUENTIAL' });

      const accessRow = result.assignments.find((a) => a.studentId === 'needs-access');
      expect(accessRow?.seatId).toBe('A2');
    });

    it('reports an accessibility-required student as unseated when no accessible seat is available', () => {
      const noAccessibleSeats = [seat('A1', 0, 0), seat('A2', 0, 1)];
      const students = [student('needs-access', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true })];

      const result = generateSeating({ seats: noAccessibleSeats, students, strategy: 'SEQUENTIAL' });

      expect(result.assignments).toEqual([]);
      expect(result.unseated).toEqual([students[0]]);
    });

    it('a non-required student CAN still use a leftover accessible seat', () => {
      const seats = [seat('A1', 0, 0, { isAccessible: true }), seat('A2', 0, 1)];
      const students = [student('s1', 'q1', 'DBMS', 'A')]; // does not require accessibility

      const result = generateSeating({ seats, students, strategy: 'SEQUENTIAL' });

      expect(result.assignments).toHaveLength(1);
      expect(result.unseated).toEqual([]);
    });
  });

  describe('capacity shortfall — unseated, never silently dropped', () => {
    it('reports leftover students as unseated when there are more students than active seats', () => {
      const seats = [seat('A1', 0, 0), seat('A2', 0, 1)];
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A'), student('s3', 'q1', 'DBMS', 'A')];

      const result = generateSeating({ seats, students, strategy: 'SEQUENTIAL' });

      expect(result.assignments).toHaveLength(2);
      expect(result.unseated).toHaveLength(1);
      expect(result.unseated[0].studentId).toBe('s3'); // canonical order: s1, s2, s3 — s3 is the leftover
    });
  });

  describe('empty inputs', () => {
    it('returns empty assignments and no unseated students for an empty roster', () => {
      const result = generateSeating({ seats: grid2x3, students: [], strategy: 'SEQUENTIAL' });
      expect(result).toEqual({ assignments: [], unseated: [] });
    });
  });
});
