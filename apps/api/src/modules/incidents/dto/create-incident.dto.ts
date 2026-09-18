import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { IncidentSeverity, IncidentType } from '@exam-sync/db';

const VALID_TYPES: IncidentType[] = [
  IncidentType.CHEATING_SUSPICION,
  IncidentType.UNAUTHORIZED_MATERIAL,
  IncidentType.MISCONDUCT,
  IncidentType.MISSING,
  IncidentType.LATE,
  IncidentType.MEDICAL,
  IncidentType.SEATING,
  IncidentType.TECHNICAL,
  IncidentType.ROOM,
  IncidentType.IDENTITY,
  IncidentType.PAPER,
  IncidentType.OTHER,
];

const VALID_SEVERITIES: IncidentSeverity[] = [
  IncidentSeverity.LOW,
  IncidentSeverity.MEDIUM,
  IncidentSeverity.HIGH,
  IncidentSeverity.CRITICAL,
];

/** `POST /incidents` — API_CONTRACT.md: body `{exam_session_id, quiz_id?, student_id?, room_id?, seat_id?, incident_type, severity, description, evidence_metadata?}`. */
export class CreateIncidentDto {
  @IsUUID()
  exam_session_id!: string;

  @IsOptional()
  @IsUUID()
  quiz_id?: string;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsUUID()
  seat_id?: string;

  @IsIn(VALID_TYPES)
  incident_type!: IncidentType;

  @IsIn(VALID_SEVERITIES)
  severity!: IncidentSeverity;

  @IsString()
  @IsNotEmpty()
  description!: string;

  /** Pointers to object storage, not raw files — undocumented shape, same posture as `GenerateSeatingDto.constraints`. */
  @IsOptional()
  @IsObject()
  evidence_metadata?: Record<string, unknown>;
}
