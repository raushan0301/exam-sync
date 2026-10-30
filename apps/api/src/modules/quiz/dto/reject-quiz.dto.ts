import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `reason` is deliberately optional at the DTO/shape level — BR-012's
 * "required" behavior is enforced in QuizzesService.reject as a 422
 * business-rule failure (API_CONTRACT.md's documented status code for this
 * specific case), not the ValidationPipe's usual 400 for a missing
 * required field.
 */
export class RejectQuizDto {
  @IsOptional()
  @IsString()
  reason?: string;

  /** The admin's note about the room request; saved with the decision and shown to the faculty. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  room_note?: string;
}
