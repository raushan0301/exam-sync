import { validateSeating } from './validate-seating';
import { SeatInput, StudentToSeatInput } from './types';

function seat(id: string, rowIndex: number, colIndex: number, overrides: Partial<SeatInput> = {}): SeatInput {
  return { id, rowIndex, colIndex, isActive: true, isAccessible: false, ...overrides };
}

function student(id: string, quizId: string, subjectId: string, batchId: string, overrides: Partial<StudentToSeatInput> = {}): StudentToSeatInput {
  return { studentId: id, quizId, subjectId, batchId, requiresAccessibleSeat: false, ...overrides };
}

const grid2x2 = [seat('A1', 0, 0), seat('A2', 0, 1), seat('B1', 1, 0), seat('B2', 1, 1)];

describe('validateSeating — pure, independent re-scan (ADR-004)', () => {
  describe('valid plan', () => {
    it('reports zero hard violations for a complete, correct plan', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'B2', studentId: 's2', quizId: 'q1' }, // diagonal — not 4-directionally adjacent
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([]);
    });
  });

  describe('BR-024 — a seat cannot hold two students', () => {
    it('reports DUPLICATE_SEAT for both assignments sharing one seat', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A1', studentId: 's2', quizId: 'q1' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations.filter((v) => v.type === 'DUPLICATE_SEAT')).toHaveLength(2);
    });
  });

  describe('BR-025 — a student cannot hold two seats', () => {
    it('reports DUPLICATE_STUDENT for both assignments of the same student', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's1', quizId: 'q1' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations.filter((v) => v.type === 'DUPLICATE_STUDENT')).toHaveLength(2);
    });
  });

  describe('inactive seat used', () => {
    it('reports INACTIVE_SEAT when an assignment targets a disabled seat', () => {
      const seats = [seat('A1', 0, 0, { isActive: false }), seat('A2', 0, 1)];
      const students = [student('s1', 'q1', 'DBMS', 'A')];
      const assignments = [{ seatId: 'A1', studentId: 's1', quizId: 'q1' }];

      const result = validateSeating({ seats, assignments, students });

      expect(result.hardViolations).toEqual([
        expect.objectContaining({ type: 'INACTIVE_SEAT', seatId: 'A1' }),
      ]);
    });
  });

  describe('BR-028 — accessibility mismatch', () => {
    it('reports ACCESSIBILITY_MISMATCH when a requiring student sits in a non-accessible seat', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true })];
      const assignments = [{ seatId: 'A1', studentId: 's1', quizId: 'q1' }]; // A1 not accessible

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([
        expect.objectContaining({ type: 'ACCESSIBILITY_MISMATCH', studentId: 's1', seatId: 'A1' }),
      ]);
    });

    it('passes when a requiring student sits in an accessible seat', () => {
      const seats = [seat('A1', 0, 0, { isAccessible: true }), seat('A2', 0, 1)];
      const students = [student('s1', 'q1', 'DBMS', 'A', { requiresAccessibleSeat: true })];
      const assignments = [{ seatId: 'A1', studentId: 's1', quizId: 'q1' }];

      const result = validateSeating({ seats, assignments, students });

      expect(result.hardViolations).toEqual([]);
    });
  });

  describe('UNSEATED_STUDENT — every roster student must have exactly one assignment', () => {
    it('reports a roster student with zero assignments', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [{ seatId: 'A1', studentId: 's1', quizId: 'q1' }]; // s2 never seated

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([
        expect.objectContaining({ type: 'UNSEATED_STUDENT', studentId: 's2' }),
      ]);
    });
  });

  describe('unknown references', () => {
    it('reports UNKNOWN_SEAT for an assignment targeting a nonexistent seat', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A')];
      const assignments = [{ seatId: 'does-not-exist', studentId: 's1', quizId: 'q1' }];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations.some((v) => v.type === 'UNKNOWN_SEAT')).toBe(true);
    });

    it('reports UNKNOWN_STUDENT for an assignment referencing a student outside the roster', () => {
      const students: StudentToSeatInput[] = [];
      const assignments = [{ seatId: 'A1', studentId: 'ghost', quizId: 'q1' }];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations.some((v) => v.type === 'UNKNOWN_STUDENT')).toBe(true);
    });
  });

  describe('BR-029 — separation pairs (HARD, structurally present, no data source yet)', () => {
    it('reports SEPARATION_VIOLATION when two paired students end up adjacent', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q1' }, // adjacent (same row)
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students, separationPairs: [['s1', 's2']] });

      expect(result.hardViolations).toEqual([
        expect.objectContaining({ type: 'SEPARATION_VIOLATION' }),
      ]);
    });

    it('does not flag a separation pair when they are NOT adjacent', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'B2', studentId: 's2', quizId: 'q1' }, // diagonal, not adjacent
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students, separationPairs: [['s1', 's2']] });

      expect(result.hardViolations).toEqual([]);
    });

    it('defaults to no separation pairs when the parameter is omitted — never a false positive', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q1' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([]);
    });
  });

  describe('soft constraints — adjacency diversity, reported not blocking', () => {
    it('reports SUBJECT_ADJACENCY for two adjacent seats holding the same subject', () => {
      const students = [
        student('s1', 'q1', 'DBMS', 'batch-A'),
        student('s2', 'q2', 'DBMS', 'batch-B'),
        student('s3', 'q3', 'OS', 'batch-C'),
      ];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q2' }, // adjacent, same subject (DBMS), different quiz/batch
        { seatId: 'B1', studentId: 's3', quizId: 'q3' }, // next to A1 but a different subject/quiz/batch
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([]); // soft, never hard
      expect(result.softViolations).toEqual([
        expect.objectContaining({ type: 'SUBJECT_ADJACENCY', seatIdA: 'A1', seatIdB: 'A2' }),
      ]);
      expect(result.softConstraintScore).toBe(0.5); // 2 adjacent pairs, 1 violates
    });

    it('reports BATCH_ADJACENCY and QUIZ_ADJACENCY independently from SUBJECT_ADJACENCY', () => {
      const students = [student('s1', 'q-same', 'DBMS', 'batch-same'), student('s2', 'q-same', 'OS', 'batch-same')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q-same' },
        { seatId: 'A2', studentId: 's2', quizId: 'q-same' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      const types = result.softViolations.map((v) => v.type).sort();
      expect(types).toEqual(['BATCH_ADJACENCY', 'QUIZ_ADJACENCY']); // different subjects, so no SUBJECT_ADJACENCY
    });

    it('scores 1.0 (perfect) when no adjacent pair violates any soft constraint', () => {
      const students = [student('s1', 'q1', 'DBMS', 'batch-A'), student('s2', 'q2', 'OS', 'batch-B')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q2' }, // adjacent but fully diverse
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.softViolations).toEqual([]);
      expect(result.softConstraintScore).toBe(1);
    });

    it('scores 1.0 when there are no adjacent occupied pairs at all', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'B2', studentId: 's2', quizId: 'q1' }, // diagonal
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.softConstraintScore).toBe(1);
    });

    it('never affects hardViolations regardless of how many soft constraints are violated', () => {
      const students = [
        student('s1', 'q1', 'DBMS', 'batch-A'),
        student('s2', 'q1', 'DBMS', 'batch-A'),
        student('s3', 'q3', 'OS', 'batch-C'),
      ];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q1' }, // same subject, batch, AND quiz — triple soft violation
        { seatId: 'B2', studentId: 's3', quizId: 'q3' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.hardViolations).toEqual([]);
      expect(result.softViolations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('single-subject room — judged on batch and roll-number spread', () => {
    it('does not report subject/quiz adjacency when the whole room sits one subject', () => {
      // 10 on the roster; two far-apart roll numbers sit side by side (the rest are not placed here — only soft output matters).
      const students = Array.from({ length: 10 }, (_, i) => student(`s${i + 1}`, 'q1', 'DBMS', 'A', { rollNumber: String(i + 1) }));
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's10', quizId: 'q1' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.softViolations).toEqual([]);
      expect(result.softConstraintScore).toBe(1);
    });

    it('reports ROLL_ADJACENCY for neighbours with consecutive roll numbers', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A', { rollNumber: '7' }), student('s2', 'q1', 'DBMS', 'A', { rollNumber: '8' })];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q1' },
      ];

      const result = validateSeating({ seats: grid2x2, assignments, students });

      expect(result.softViolations).toEqual([expect.objectContaining({ type: 'ROLL_ADJACENCY', seatIdA: 'A1', seatIdB: 'A2' })]);
      expect(result.softConstraintScore).toBe(0);
    });
  });

  describe('purity / independence (ADR-004)', () => {
    it('never mutates its input arrays', () => {
      const seats = [...grid2x2];
      const students = [student('s1', 'q1', 'DBMS', 'A')];
      const assignments = [{ seatId: 'A1', studentId: 's1', quizId: 'q1' }];
      const seatsSnapshot = JSON.stringify(seats);
      const studentsSnapshot = JSON.stringify(students);
      const assignmentsSnapshot = JSON.stringify(assignments);

      validateSeating({ seats, assignments, students });

      expect(JSON.stringify(seats)).toBe(seatsSnapshot);
      expect(JSON.stringify(students)).toBe(studentsSnapshot);
      expect(JSON.stringify(assignments)).toBe(assignmentsSnapshot);
    });

    it('is a pure function of its inputs — same inputs, same result, called repeatedly', () => {
      const students = [student('s1', 'q1', 'DBMS', 'A'), student('s2', 'q1', 'DBMS', 'A')];
      const assignments = [
        { seatId: 'A1', studentId: 's1', quizId: 'q1' },
        { seatId: 'A2', studentId: 's2', quizId: 'q1' },
      ];
      const input = { seats: grid2x2, assignments, students };

      const results = [1, 2, 3].map(() => validateSeating(input));
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
    });
  });
});
