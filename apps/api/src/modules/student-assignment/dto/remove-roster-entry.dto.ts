import { IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `DELETE /exam-sessions/{id}/roster/{student_id}` (EC-016: "cancels
 * assignment"). `quiz_id` disambiguates which of the session's attached
 * quizzes to cancel the assignment for (same disclosed extrapolation as
 * `AddRosterEntryDto`); `reason` follows the same required-non-empty
 * pattern as `CancelExamSessionDto` (ARCHITECTURE.md §AD-2's "reason
 * mandatory and audited" convention, applied consistently here too).
 */
export class RemoveRosterEntryDto {
  @IsUUID()
  quiz_id!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
