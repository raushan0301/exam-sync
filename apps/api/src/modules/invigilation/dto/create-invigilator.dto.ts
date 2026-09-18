import { IsIn, IsUUID } from 'class-validator';
import { InvigilatorRole } from '@exam-sync/db';

const VALID_ROLES: InvigilatorRole[] = [InvigilatorRole.LEAD_INVIGILATOR, InvigilatorRole.ASSISTANT_INVIGILATOR];

/** `POST /exam-sessions/{id}/invigilators` — API_CONTRACT.md: body `{room_id, faculty_id, role}`. */
export class CreateInvigilatorDto {
  @IsUUID()
  room_id!: string;

  @IsUUID()
  faculty_id!: string;

  @IsIn(VALID_ROLES)
  role!: InvigilatorRole;
}
