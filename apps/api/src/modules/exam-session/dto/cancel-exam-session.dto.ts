import { IsString, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /exam-sessions/{id}/cancel` body `{reason}` — required, per EC-024/ARCHITECTURE.md §AD-2 ("CANCELLED reason mandatory and audited"). */
export class CancelExamSessionDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
