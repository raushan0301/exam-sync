module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  // Phase 0 has no domain logic yet (state machines/constraint engine land
  // starting Phase 6+) — pass rather than fail on an empty suite.
  passWithNoTests: true,
};
