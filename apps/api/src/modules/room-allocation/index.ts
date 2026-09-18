export * from './room-allocation.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. Phase 13 (Seating Engine) will inject
// RoomAllocationService (or query `exam_session_rooms` directly) via this
// barrel.
export { RoomAllocationService } from './room-allocation.service';
