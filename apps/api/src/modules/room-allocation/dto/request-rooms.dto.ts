import { ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `POST /exam-sessions/{id}/rooms/request` (FACULTY, ownership-gated).
 * Faculty submits the room set they picked from `RoomSuggestionService`
 * (or hand-picked) for admin review — this does NOT allocate anything
 * yet, it only records the request and moves the session to
 * ROOM_ALLOCATION so an admin can review live availability, swap rooms,
 * and approve (`allocate`) or reject.
 */
export class RequestRoomsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  room_ids!: string[];

  /** Single optional backup room — must not also appear in room_ids. */
  @IsOptional()
  @IsUUID()
  backup_room_id?: string;

  /** Which RoomSuggestionService strategy produced room_ids — display-only, shown to the admin during review. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  strategy?: string;

  /** ADMIN only — a short note explaining an adjustment (room swap, backup removed), shown back to the faculty. Ignored when the caller is FACULTY. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  admin_note?: string;
}

/** `POST /exam-sessions/{id}/rooms/reject` (ADMIN). */
export class RejectRoomRequestDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
