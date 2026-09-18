import { deriveAcademicYear } from './derive-academic-year';

describe('deriveAcademicYear', () => {
  it('returns the academicYear field when present and numeric', () => {
    expect(deriveAcademicYear({ id: 'q1', academicYear: 2026 })).toBe(2026);
  });

  it('returns null when the field is absent', () => {
    expect(deriveAcademicYear({ id: 'r1', name: 'Room 101' })).toBeNull();
  });

  it('returns null for null/undefined/non-object input', () => {
    expect(deriveAcademicYear(undefined)).toBeNull();
    expect(deriveAcademicYear(null)).toBeNull();
    expect(deriveAcademicYear('string')).toBeNull();
  });
});
