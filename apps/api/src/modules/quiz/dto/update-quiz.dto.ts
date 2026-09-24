import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

/**
 * API_CONTRACT.md: `PATCH /quizzes/{id}` — "partial; requires `If-Match:
 * version`". The version itself travels as the `If-Match` header (see
 * quizzes.controller.ts), not a body field — a body-supplied version could
 * be forgotten/stale independent of what the client actually has cached,
 * whereas a header is the standard HTTP mechanism for exactly this
 * optimistic-concurrency use case.
 */
export class UpdateQuizDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsUUID()
  subject_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  batch_ids?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  student_count?: number;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  quiz_type?: string;

  @IsOptional()
  @IsDateString()
  preferred_date?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'preferred_time must be in HH:MM or HH:MM:SS format' })
  preferred_time?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  academic_year?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  semester?: number;
}
