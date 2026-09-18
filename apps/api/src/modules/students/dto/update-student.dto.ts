import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

/** API_CONTRACT.md: `PATCH /students/{id}` — "status change etc." */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  roll_number?: string;

  @IsOptional()
  @IsEnum(AcademicStatus)
  status?: AcademicStatus;
}
