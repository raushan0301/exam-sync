import { IsIn, IsUUID } from 'class-validator';
import { AttendanceMethod, AttendanceStatus } from '@exam-sync/db';

const VALID_STATUSES: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.EXCUSED,
  AttendanceStatus.MEDICAL,
  AttendanceStatus.OTHER,
];

/** MANUAL/SEAT_BASED only — QR/BIOMETRIC are pre-sized on the schema but have no capture flow in Phase 17. */
const VALID_METHODS: AttendanceMethod[] = [AttendanceMethod.MANUAL, AttendanceMethod.SEAT_BASED];

/** `POST /exam-sessions/{id}/attendance` — API_CONTRACT.md: body `{student_id, status, method}`. */
export class MarkAttendanceDto {
  @IsUUID()
  student_id!: string;

  @IsIn(VALID_STATUSES)
  status!: AttendanceStatus;

  @IsIn(VALID_METHODS)
  method!: AttendanceMethod;
}
