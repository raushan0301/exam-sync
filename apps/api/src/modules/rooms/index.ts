export * from './rooms.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. Phase 12 (Room Allocation) will inject
// RoomsService via this barrel.
export { RoomsService } from './rooms.service';
