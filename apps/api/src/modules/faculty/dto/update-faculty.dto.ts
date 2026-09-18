import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AcademicStatus } from '@exam-sync/db';

export class UpdateFacultyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUUID()
  department_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  employee_code?: string;

  @IsOptional()
  @IsEnum(AcademicStatus)
  status?: AcademicStatus;
}
