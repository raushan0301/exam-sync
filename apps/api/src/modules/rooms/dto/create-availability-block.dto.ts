import { IsDateString, IsString, Matches, MinLength } from 'class-validator';

/** `POST /rooms/{id}/availability-blocks` — API_CONTRACT.md: `{date, start_time, end_time, reason}`. */
export class CreateAvailabilityBlockDto {
  @IsDateString()
  date!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/)
  start_time!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/)
  end_time!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
