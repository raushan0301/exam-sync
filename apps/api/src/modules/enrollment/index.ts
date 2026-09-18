export * from './enrollment.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// academic-structure/index.ts, auth/index.ts, faculty/index.ts,
// faculty-assignment/index.ts. Phase 6 (Quiz) will inject
// EnrollmentsService.isEnrolled via this barrel for eligibility checks.
export { EnrollmentsService } from './enrollments.service';
