import { IsIn, IsUUID } from 'class-validator';
import { AttendanceMethod, AttendanceStatus } from '@exam-sync/db';

// Only PRESENT/ABSENT are accepted here — LATE/EXCUSED/MEDICAL/OTHER
// remain valid `AttendanceStatus` enum values (existing historical rows
// keep whatever they were marked as; dropping them from the Prisma enum
// itself would require a destructive migration Postgres refuses while
// any row still uses them), but the faculty-facing seat-map UI only ever
// offers a Present/Absent toggle now, so the API stops accepting the rest
// at the boundary too — the mark/update flow and the enum have simply
// diverged, same as PENDING student statuses elsewhere in this codebase.
const VALID_STATUSES: AttendanceStatus[] = [AttendanceStatus.PRESENT, AttendanceStatus.ABSENT];

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
