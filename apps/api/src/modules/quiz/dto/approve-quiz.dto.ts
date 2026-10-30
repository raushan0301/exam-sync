import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Optional body for `POST /quizzes/{id}/approve`. */
export class ApproveQuizDto {
  /** The admin's note about the room request (e.g. why a backup room was removed); saved with the decision and shown to the faculty. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  room_note?: string;
}
