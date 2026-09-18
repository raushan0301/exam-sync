import { IsIn, IsOptional, IsString } from 'class-validator';
import { AttendanceStatus } from '@exam-sync/db';

const VALID_STATUSES: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.EXCUSED,
  AttendanceStatus.MEDICAL,
  AttendanceStatus.OTHER,
];

/** `PATCH /attendance/{id}` — API_CONTRACT.md: body `{status, reason}`; `reason` is required only when the row is already locked (BR-035), so it is optional at the DTO shape level and checked in the service (423, not the ValidationPipe's usual 400) — same "conditionally required" split already used for Quiz reject's `reason` (BR-012). */
export class UpdateAttendanceDto {
  @IsIn(VALID_STATUSES)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
