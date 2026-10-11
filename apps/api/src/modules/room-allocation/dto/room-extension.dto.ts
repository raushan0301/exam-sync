import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** `POST /exam-sessions/{id}/room-requests` (FACULTY) — ask for more rooms during seating. */
export class CreateRoomRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  room_ids!: string[];

  /** Why more rooms are needed — shown to the admin. */
  @IsString()
  @MinLength(10, { message: 'Please explain in at least 10 characters why more rooms are needed.' })
  @MaxLength(2000)
  reason!: string;

  /** The "leave every second seat column empty?" answer — becomes the session's seating default when approved. */
  @IsOptional()
  @IsBoolean()
  empty_columns?: boolean;
}

/** `POST /room-requests/{id}/approve` (ADMIN) — may change the asked-for rooms; the note is optional. */
export class ApproveRoomRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  room_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** `POST /room-requests/{id}/reject` (ADMIN) — a decline must say why, since the faculty member sees it. */
export class RejectRoomRequestByAdminDto {
  @IsString()
  @MinLength(1, { message: 'Please explain why the request is being declined.' })
  @MaxLength(2000)
  note!: string;
}
