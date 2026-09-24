import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

/** PATCH /batches/{id} — extrapolated from the documented department shape (see programs' DTO note). */
export class UpdateBatchDto {
  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  year?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  section?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subsection?: string;

  @IsOptional()
  @IsEnum(AcademicStatus)
  status?: AcademicStatus;
}
