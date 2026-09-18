import { IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * `POST /rooms` — API_CONTRACT.md doesn't spell out the body; fields taken
 * directly from ARCHITECTURE.md §R's literal `rooms(id, building, floor,
 * room_number, capacity, rows, columns, status, accessibility_info,
 * created_at, updated_at)`. `rows`/`columns` are required here (not
 * optional) because this phase's `POST /rooms` immediately generates the
 * room's `room_seats` map from them (IMPLEMENTATION_PLAN.md Phase 11 test
 * note: "seat map generation from rows×columns") — a room with no seat
 * layout at all isn't a documented scenario. `status` is not accepted at
 * creation — every room starts `ACTIVE` (the schema default); use `PATCH`
 * to change it afterward.
 */
export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  building!: string;

  @IsInt()
  floor!: number;

  @IsString()
  @MinLength(1)
  room_number!: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsInt()
  @Min(1)
  rows!: number;

  @IsInt()
  @Min(1)
  columns!: number;

  @IsOptional()
  @IsObject()
  accessibility_info?: Record<string, unknown>;
}
