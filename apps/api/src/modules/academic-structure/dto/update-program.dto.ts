import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

/**
 * PATCH /programs/{id} — extrapolated from the documented
 * PATCH /departments/{id} shape (API_CONTRACT.md doesn't spell this one out
 * individually, but IMPLEMENTATION_PLAN.md Phase 2 requires full CRUD for
 * programs — see this session's pre-implementation plan).
 */
export class UpdateProgramDto {
  @IsOptional()
  @IsUUID()
  department_id?: string;

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
}
