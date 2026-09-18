import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * API_CONTRACT.md: `POST /students` body "incl. program_id, batch_id,
 * roll_number" (non-exhaustive). Extended with `name` and `email` per this
 * phase's disclosed pre-implementation decision: neither field exists in
 * the documented schema, but a student record needs a human-readable name
 * and a login-capable account needs an email — both created atomically by
 * this endpoint (see students.service.ts).
 */
export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsUUID()
  program_id!: string;

  @IsUUID()
  batch_id!: string;

  @IsString()
  @MinLength(1)
  roll_number!: string;
}
