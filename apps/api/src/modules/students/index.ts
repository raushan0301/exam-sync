export * from './students.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// academic-structure/index.ts, auth/index.ts, faculty/index.ts. Phase 5's
// EnrollmentModule injects StudentsService via this barrel.
export { StudentsService } from './students.service';
