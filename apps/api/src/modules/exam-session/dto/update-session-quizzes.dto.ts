import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** API_CONTRACT.md: `PATCH /exam-sessions/{id}/quizzes` body `{add: [quiz_id...], remove: [quiz_id...]}`. */
export class UpdateSessionQuizzesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  add: string[] = [];

  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  remove: string[] = [];
}
