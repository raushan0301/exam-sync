import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /suspension-requests/{id}/approve` — the admin's note is optional. */
export class ApproveSuspensionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** `POST /suspension-requests/{id}/reject` — a rejection must say why, since the faculty sees it. */
export class RejectSuspensionDto {
  @IsString()
  @MinLength(1, { message: 'Please explain why the request is being declined.' })
  @MaxLength(2000)
  note!: string;
}
