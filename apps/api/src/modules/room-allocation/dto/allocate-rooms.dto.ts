import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * `POST /exam-sessions/{id}/rooms/allocate` — API_CONTRACT.md: body
 * `{room_ids[]}` (manual — the admin's exact candidate set) OR
 * `{auto: true, candidate_room_ids[]}` (algorithmic — `candidate_room_ids`
 * optionally narrows the auto-search; omitted, it searches all ACTIVE,
 * available rooms via `RoomsService.findAvailable`). Either way, the SAME
 * Best-Fit Decreasing packer runs — "manual" only changes where the
 * candidate room set comes from, not whether packing happens (this DTO
 * carries no per-room capacity breakdown, so there is nothing else for
 * "manual" to mean).
 */
export class AllocateRoomsDto {
  @IsOptional()
  @IsBoolean()
  auto?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  room_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  candidate_room_ids?: string[];
}
