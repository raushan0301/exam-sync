import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

/** API_CONTRACT.md: `PATCH /departments/{id}` — "partial fields incl. `status`". */
export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsEnum(AcademicStatus)
  status?: AcademicStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
