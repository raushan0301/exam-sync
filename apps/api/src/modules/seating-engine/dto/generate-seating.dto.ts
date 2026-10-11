import { IsBoolean, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { SeatingStrategyName } from '@exam-sync/domain-logic';

/** The four supported strategies. Older plans may still carry RANDOMIZED / ANTI_CHEATING (the DB enum keeps them) but new ones cannot be created. */
const SUPPORTED_STRATEGIES: SeatingStrategyName[] = ['SEQUENTIAL', 'ALTERNATE_SUBJECT', 'ALTERNATE_BATCH', 'SUBJECT_BATCH_MIX'];

/** `POST /exam-sessions/{id}/seating/generate` — API_CONTRACT.md: body `{room_id, strategy, constraints: {...}}`. */
export class GenerateSeatingDto {
  @IsUUID()
  room_id!: string;

  @IsIn(SUPPORTED_STRATEGIES)
  strategy!: SeatingStrategyName;

  /** Leave every second column of the room empty (1st, 3rd, 5th... used) so nobody has a side neighbour. Asked before generating; default off. */
  @IsOptional()
  @IsBoolean()
  skip_alternate_columns?: boolean;

  /** Undocumented shape anywhere in the docs — accepted but currently unused; reserved for future per-generation tuning. */
  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>;
}
