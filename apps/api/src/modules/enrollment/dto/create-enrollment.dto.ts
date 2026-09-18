import { IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /enrollments` body `{student_id, subject_id, batch_id, academic_year, semester}`. */
export class CreateEnrollmentDto {
  @IsUUID()
  student_id!: string;

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
}
