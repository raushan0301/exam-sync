import { IsDateString, IsString, Matches, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /exam-sessions` body `{name, session_date, start_time, end_time}`. */
export class CreateExamSessionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsDateString()
  session_date!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'start_time must be in HH:MM or HH:MM:SS format' })
  start_time!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'end_time must be in HH:MM or HH:MM:SS format' })
  end_time!: string;
}
