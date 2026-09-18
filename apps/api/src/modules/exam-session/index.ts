export * from './exam-session.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. Phase 9+ (student assignment, room
// allocation, seating) will inject ExamSessionsService via this barrel.
export { ExamSessionsService } from './exam-sessions.service';
