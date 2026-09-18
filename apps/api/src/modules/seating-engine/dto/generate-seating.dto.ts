import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { SeatingStrategyName } from '@exam-sync/domain-logic';

/** All 6 strategies (ARCHITECTURE.md §T) — Phase 13 implemented the first 5; Phase 14 adds `ANTI_CHEATING` (§U), lifting the restriction Phase 13's own DTO comment disclosed as temporary. */
const SUPPORTED_STRATEGIES: SeatingStrategyName[] = [
  'SEQUENTIAL',
  'RANDOMIZED',
  'ALTERNATE_SUBJECT',
  'ALTERNATE_BATCH',
  'SUBJECT_BATCH_MIX',
  'ANTI_CHEATING',
];

/** `POST /exam-sessions/{id}/seating/generate` — API_CONTRACT.md: body `{room_id, strategy, constraints: {...}}`. */
export class GenerateSeatingDto {
  @IsUUID()
  room_id!: string;

  @IsIn(SUPPORTED_STRATEGIES)
  strategy!: SeatingStrategyName;

  /** Undocumented shape anywhere in the docs — accepted but currently unused; reserved for future per-generation tuning. */
  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>;
}
