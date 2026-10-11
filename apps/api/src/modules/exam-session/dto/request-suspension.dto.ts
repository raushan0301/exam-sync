import { IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /exam-sessions/{id}/suspension-request` — the faculty's justification is mandatory and must be a real explanation, not a word. */
export class RequestSuspensionDto {
  @IsString()
  @MinLength(10, { message: 'Please describe why this session should be suspended (at least 10 characters).' })
  @MaxLength(2000)
  reason!: string;
}
