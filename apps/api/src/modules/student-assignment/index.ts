export * from './student-assignment.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. No later phase depends on
// StudentAssignmentService yet (Room Allocation/Seating consume the
// roster's data via direct Prisma queries scoped to their own modules,
// not by injecting this service) — exported anyway for consistency with
// every other module in this codebase.
export { StudentAssignmentService } from './student-assignment.service';
