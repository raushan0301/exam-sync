export * from './academic-structure.module';
// Re-exports mirror this module's own `exports: [...]` array in
// academic-structure.module.ts — the barrel is the sanctioned cross-module
// import path (ARCHITECTURE.md §AW, ADR-001); it must not expose anything
// beyond what that module already declares as intentionally public.
export { DepartmentsService } from './departments.service';
export { ProgramsService } from './programs.service';
export { BatchesService } from './batches.service';
export { SubjectsService } from './subjects.service';
