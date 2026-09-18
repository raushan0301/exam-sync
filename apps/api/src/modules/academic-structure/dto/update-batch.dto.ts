import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

/** PATCH /batches/{id} — extrapolated from the documented department shape (see programs' DTO note). */
export class UpdateBatchDto {
  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  year?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  section?: string;

  @IsOptional()
  @IsEnum(AcademicStatus)
  status?: AcademicStatus;
}
