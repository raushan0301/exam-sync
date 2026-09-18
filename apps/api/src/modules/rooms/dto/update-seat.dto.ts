import { IsBoolean, IsOptional } from 'class-validator';

/** `PATCH /rooms/{id}/seats/{seatId}` — IMPLEMENTATION_PLAN.md Phase 11 test note: "individual seat disable." */
export class UpdateSeatDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_accessible?: boolean;
}
