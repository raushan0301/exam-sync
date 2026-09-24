import { generateDefaultPassword } from './generate-default-password';

describe('generateDefaultPassword', () => {
  it('lowercases the name and strips spaces, joined to the identifier with an underscore', () => {
    expect(generateDefaultPassword('CSE2026001', 'Jane Doe')).toBe('CSE2026001_janedoe');
  });

  it('collapses multiple/internal spaces in a longer name', () => {
    expect(generateDefaultPassword('FAC001', 'John  Michael Smith')).toBe('FAC001_johnmichaelsmith');
  });

  it('does not touch punctuation in the name (only whitespace is stripped)', () => {
    expect(generateDefaultPassword('EMP-001', 'Dr. Grace Hopper')).toBe('EMP-001_dr.gracehopper');
  });
});
