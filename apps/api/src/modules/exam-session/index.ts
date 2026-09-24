export * from './exam-session.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. Phase 9+ (student assignment, room
// allocation, seating) will inject ExamSessionsService via this barrel.
export { ExamSessionsService } from './exam-sessions.service';
// Faculty-lifecycle-ownership change: consumer modules (student-assignment,
// room-allocation, seating-engine, invigilation) need this to gate their
// own faculty-only write endpoints the same way QuizOwnershipService gates
// quiz PATCH/submit — see this service's own header comment.
export { ExamSessionOwnershipService } from './exam-session-ownership.service';
