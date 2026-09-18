import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * API_CONTRACT.md: `POST /faculty` (no documented body shape). Mirrors
 * Phase 3's CreateStudentDto pattern exactly: `name`/`email` are the same
 * disclosed additions made there (no name field anywhere in the documented
 * schema; email is needed to provision the linked login-capable User).
 */
export class CreateFacultyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsUUID()
  department_id!: string;

  @IsString()
  @MinLength(1)
  employee_code!: string;
}
