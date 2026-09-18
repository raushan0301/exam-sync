export * from './faculty.module';
// Mirrors faculty.module.ts's own `exports: [...]` array — see the same
// note in academic-structure/index.ts and auth/index.ts. Phase 5
// (faculty_subject_batch_assignment) will inject FacultyService via this
// barrel, not by reaching into faculty.service.ts directly.
export { FacultyService } from './faculty.service';
