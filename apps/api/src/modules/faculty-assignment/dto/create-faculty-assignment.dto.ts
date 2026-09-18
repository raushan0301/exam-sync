import { IsEnum, IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { FacultyAssignmentRole } from '@exam-sync/db';

/** API_CONTRACT.md: `POST /faculty-assignments` body `{faculty_id, subject_id, batch_id, academic_year, semester, role}`. */
export class CreateFacultyAssignmentDto {
  @IsUUID()
  faculty_id!: string;

  @IsUUID()
  subject_id!: string;

  @IsUUID()
  batch_id!: string;

  @IsString()
  @MinLength(1)
  academic_year!: string;

  @IsInt()
  @Min(1)
  semester!: number;

  @IsEnum(FacultyAssignmentRole)
  role!: FacultyAssignmentRole;
}
