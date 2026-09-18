import { IsOptional, IsString } from 'class-validator';

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
}
