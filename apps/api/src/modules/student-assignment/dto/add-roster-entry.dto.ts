import { IsUUID } from 'class-validator';

/**
 * `POST /exam-sessions/{id}/roster/{student_id}` — API_CONTRACT.md
 * documents this endpoint ("manual add — late/waitlist") but does not
 * specify a request body. A session can have multiple attached quizzes
 * (Phase 8), so a manual add must disambiguate which one it targets —
 * `quiz_id` is a disclosed extrapolation, not literally spelled out in
 * the doc.
 */
export class AddRosterEntryDto {
  @IsUUID()
  quiz_id!: string;
}
