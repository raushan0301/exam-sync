import { IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

/**
 * API_CONTRACT.md only says `POST/GET/PATCH /subjects` without spelling out
 * the body shape; fields taken directly from ARCHITECTURE.md §AC's literal
 * schema: `subjects(id, department_id, program_id NULL, code, name, credits, is_active)`.
 */
export class CreateSubjectDto {
  @IsUUID()
  department_id!: string;

  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // Float, not int — some programs award half-credit subjects (e.g. 4.5).
  @IsOptional()
  @IsNumber()
  @Min(0)
  credits?: number;
}
