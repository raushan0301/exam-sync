export * from './conflict-engine.module';
// Mirrors this module's own `exports: [...]` array — see the same note in
// academic-structure/index.ts, auth/index.ts, etc. exam-session/index.ts
// injects ConflictEngineService via this barrel.
export { ConflictEngineService } from './conflict-engine.service';
export * from './conflict-engine.types';
