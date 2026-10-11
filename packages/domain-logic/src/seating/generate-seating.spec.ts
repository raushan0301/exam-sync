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

  describe('one-subject room — spread dispatch', () => {
    it('still respects the accessibility pre-pass (BR-028) ahead of the spread', () => {
      const seatsWithOneAccessible = [seat('A1', 0, 0), seat('A2', 0, 1, { isAccessible: true }), seat('A3', 0, 2)];
      const students = [
        student('needs-access', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true }),
        student('other-1', 'q1', 'DBMS', 'A'),
        student('other-2', 'q1', 'DBMS', 'A'),
      ];

      const result = generateSeating({ seats: seatsWithOneAccessible, students, strategy: 'ALTERNATE_SUBJECT', seed: 'x' });

      expect(result.assignments.find((a) => a.studentId === 'needs-access')?.seatId).toBe('A2');
      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_SPREAD');
    });

    it('does not use the spread when the room really has several subjects', () => {
      const students = [student('d1', 'q-d', 'DBMS', 'A'), student('o1', 'q-o', 'OS', 'A')];
      const result = generateSeating({ seats: grid2x3, students, strategy: 'ALTERNATE_SUBJECT' });
      expect(result.fallbackReason).toBeUndefined();
    });
  });

  describe('every strategy, shared invariants', () => {
    const strategies: SeatingStrategyName[] = ['SEQUENTIAL', 'ALTERNATE_SUBJECT', 'ALTERNATE_BATCH', 'SUBJECT_BATCH_MIX'];

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

  describe('skipAlternateColumns', () => {
    const grid = Array.from({ length: 12 }, (_, i) => seat(`S${i}`, Math.floor(i / 4), i % 4)); // 3 rows x 4 cols
    const roster = (n: number) => Array.from({ length: n }, (_, i) => student(`s${i}`, 'q1', 'DBMS', 'A'));

    it('uses only the 1st and 3rd columns', () => {
      const result = generateSeating({ seats: grid, students: roster(6), strategy: 'SEQUENTIAL', skipAlternateColumns: true });
      const cols = result.assignments.map((a) => Number(a.seatId.slice(1)) % 4);
      expect(new Set(cols)).toEqual(new Set([0, 2]));
      expect(result.unseated).toHaveLength(0);
    });

    it('reports the students that no longer fit as unseated, never drops them', () => {
      const result = generateSeating({ seats: grid, students: roster(8), strategy: 'SEQUENTIAL', skipAlternateColumns: true });
      expect(result.assignments).toHaveLength(6);
      expect(result.unseated).toHaveLength(2);
    });
  });

  describe('mixing strategy with nothing to mix', () => {
    it('ALTERNATE_SUBJECT on a one-subject room uses the roll-number spread', () => {
      const seats = [seat('A1', 0, 0), seat('A2', 0, 1), seat('A3', 0, 2), seat('A4', 0, 3)];
      const students = [1, 2, 3, 4].map((n) => student(`s${n}`, 'q1', 'DBMS', 'A'));
      const result = generateSeating({ seats, students, strategy: 'ALTERNATE_SUBJECT', seed: 'x' });
      expect(result.fallbackReason).toBe('SINGLE_SUBJECT_SPREAD');
    });

    it('SEQUENTIAL is never replaced', () => {
      const seats = [seat('A1', 0, 0), seat('A2', 0, 1)];
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      expect(generateSeating({ seats, students, strategy: 'SEQUENTIAL' }).fallbackReason).toBeUndefined();
    });
  });

  describe('mixing strategies — rows flip, uneven groups are spread', () => {
    function room(rows: number, cols: number): SeatInput[] {
      return Array.from({ length: rows * cols }, (_, i) => seat(`S${i}`, Math.floor(i / cols), i % cols));
    }
    function roster(counts: number[]): StudentToSeatInput[] {
      return counts.flatMap((n, g) =>
        Array.from({ length: n }, (_, i) => student(`g${g}-${String(i).padStart(3, '0')}`, `q${g}`, `sub${g}`, 'A')),
      );
    }
    /** Group (quiz) sitting at each "row:col". */
    function layout(seats: SeatInput[], students: StudentToSeatInput[], assignments: { seatId: string; studentId: string }[]) {
      const quizOf = new Map(students.map((s) => [s.studentId, s.quizId]));
      const seatOf = new Map(seats.map((s) => [s.id, s]));
      const at = new Map<string, string>();
      for (const a of assignments) {
        const s = seatOf.get(a.seatId)!;
        at.set(`${s.rowIndex}:${s.colIndex}`, quizOf.get(a.studentId)!);
      }
      return at;
    }

    it('two subjects with empty columns (4 seats per row): front/back neighbours differ, not just side ones', () => {
      const seats = room(4, 7);
      const students = roster([6, 6]);
      const result = generateSeating({ seats, students, strategy: 'ALTERNATE_SUBJECT', skipAlternateColumns: true });
      const at = layout(seats, students, result.assignments);

      expect(result.unseated).toHaveLength(0);
      for (const [key, quiz] of at) {
        const [r, c] = key.split(':').map(Number);
        const behind = at.get(`${r + 1}:${c}`);
        if (behind) expect(behind).not.toBe(quiz);
      }
    });

    it('three subjects with 6 seats per row: rows rotate so nobody has the same subject in front', () => {
      const seats = room(3, 6);
      const students = roster([6, 6, 6]);
      const result = generateSeating({ seats, students, strategy: 'ALTERNATE_SUBJECT' });
      const at = layout(seats, students, result.assignments);

      for (const [key, quiz] of at) {
        const [r, c] = key.split(':').map(Number);
        const behind = at.get(`${r + 1}:${c}`);
        if (behind) expect(behind).not.toBe(quiz);
      }
    });

    it('uneven groups with spare seats: the big group is spaced out with empty seats, never touching itself', () => {
      const seats = room(6, 7);
      const students = roster([10, 4]);
      const result = generateSeating({ seats, students, strategy: 'ALTERNATE_SUBJECT' });
      const at = layout(seats, students, result.assignments);

      expect(result.unseated).toHaveLength(0);
      expect(result.assignments).toHaveLength(14);
      for (const [key, quiz] of at) {
        const [r, c] = key.split(':').map(Number);
        expect(at.get(`${r}:${c + 1}`)).not.toBe(quiz);
        expect(at.get(`${r + 1}:${c}`)).not.toBe(quiz);
      }
    });

    it('uneven groups with NO spare seats: everyone is still seated (best effort, never dropped)', () => {
      const seats = room(2, 7);
      const result = generateSeating({ seats, students: roster([10, 4]), strategy: 'ALTERNATE_SUBJECT' });
      expect(result.assignments).toHaveLength(14);
      expect(result.unseated).toHaveLength(0);
    });
  });

  describe('mixing strategies — small groups are spread, clashes are minimised', () => {
    function layoutOf(rows: number, cols: number, counts: number[], skip = false) {
      const seats = Array.from({ length: rows * cols }, (_, i) => seat(`S${i}`, Math.floor(i / cols), i % cols));
      const students = counts.flatMap((n, g) =>
        Array.from({ length: n }, (_, i) => student(`g${g}-${String(i).padStart(3, '0')}`, `q${g}`, `sub${g}`, 'A')),
      );
      const result = generateSeating({ seats, students, strategy: 'ALTERNATE_SUBJECT', skipAlternateColumns: skip });
      const quizOf = new Map(students.map((s) => [s.studentId, s.quizId]));
      const at = new Map<string, string>();
      for (const a of result.assignments) {
        const s = seats.find((x) => x.id === a.seatId)!;
        at.set(`${s.rowIndex}:${s.colIndex}`, quizOf.get(a.studentId)!);
      }
      let clashes = 0;
      for (const [key, quiz] of at) {
        const [r, c] = key.split(':').map(Number);
        if (at.get(`${r}:${c + 1}`) === quiz) clashes += 1;
        if (at.get(`${r + 1}:${c}`) === quiz) clashes += 1;
      }
      return { result, clashes, at };
    }

    it('12 + 4: the small group is spread so no student has a same-subject neighbour', () => {
      const { clashes, result } = layoutOf(4, 6, [12, 4]);
      expect(result.unseated).toHaveLength(0);
      expect(clashes).toBe(0);
    });

    it('14 + 2 in a 4x6 room: the clashes the room forces are kept to a minimum (no long same-subject strings)', () => {
      const { clashes, result } = layoutOf(4, 6, [14, 2]);
      expect(result.assignments).toHaveLength(16);
      expect(clashes).toBeLessThanOrEqual(4);
    });

    it('9 + 3 with empty columns: the three small-group students end up in different rows, one clash per column at most', () => {
      const { clashes, result, at } = layoutOf(4, 6, [9, 3], true);
      expect(result.unseated).toHaveLength(0);
      expect(clashes).toBeLessThanOrEqual(3);
      expect([...at.values()].filter((q) => q === 'q1')).toHaveLength(3);
    });
  });
});
