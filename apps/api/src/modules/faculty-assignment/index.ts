export * from './faculty-assignment.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// academic-structure/index.ts, auth/index.ts, faculty/index.ts.
// StudentsModule (isFacultyTeachingBatch) and EnrollmentModule inject this
// via the barrel, not by reaching into faculty-assignments.service.ts
// directly.
export { FacultyAssignmentsService } from './faculty-assignments.service';
