import { IsEnum } from 'class-validator';
import { EnrollmentStatus } from '@exam-sync/db';

/** API_CONTRACT.md: `PATCH /enrollments/{id}` body `{status}` (e.g. DROPPED). */
export class UpdateEnrollmentDto {
  @IsEnum(EnrollmentStatus)
  status!: EnrollmentStatus;
}
