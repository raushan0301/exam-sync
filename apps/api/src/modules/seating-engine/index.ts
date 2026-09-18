export * from './seating-engine.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// every other module barrel. Phase 14 (Anti-Cheating) will inject
// SeatingEngineService via this barrel.
export { SeatingEngineService } from './seating-engine.service';
