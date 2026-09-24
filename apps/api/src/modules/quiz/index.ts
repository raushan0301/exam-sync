export * from './quiz.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// academic-structure/index.ts, auth/index.ts, faculty/index.ts,
// faculty-assignment/index.ts, enrollment/index.ts. Phase 7 (Admin
// Approval) and Phase 8 (Exam Sessions) will inject QuizzesService via
// this barrel.
export { QuizzesService } from './quizzes.service';
// Faculty-lifecycle-ownership change: ExamSessionOwnershipService (in the
// exam-session module) reuses this directly rather than re-implementing
// the owner-or-co-instructor rule.
export { QuizOwnershipService } from './quiz-ownership.service';
