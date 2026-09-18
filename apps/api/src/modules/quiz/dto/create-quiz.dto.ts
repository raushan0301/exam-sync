import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

/**
 * API_CONTRACT.md: `POST /quizzes` body (field list non-exhaustive per the
 * contract's own phrasing). Only the identifying + BR-010
 * authorization-scoping fields are required here — everything else can be
 * filled in later via PATCH before `POST .../submit`, which is what
 * actually enforces full completeness (see Quiz model's schema comment for
 * why: a permanently-complete-at-creation DRAFT would make the documented
 * "submit fails on incomplete quiz (422)" test case unreachable).
 */
export class CreateQuizDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsUUID()
  subject_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  batch_ids!: string[];

  @IsString()
  @MinLength(1)
  academic_year!: string;

  @IsInt()
  @Min(1)
  semester!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration_minutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  total_marks?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  question_count?: number;

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
}
