import { IsIn, IsUUID } from 'class-validator';
import { ReportFormat } from '@exam-sync/db';

const VALID_FORMATS: ReportFormat[] = [ReportFormat.CSV, ReportFormat.EXCEL];

/**
 * `POST /reports/{attendance|seating-plan|incident-report|room-utilization}`
 * — API_CONTRACT.md's Reports table documents the body ONLY for the first
 * of these four ("same async pattern" covers the other three's response
 * shape, not their request body). Disclosed interpretation: all four
 * share this identical `{exam_session_id, format}` shape — the natural,
 * consistent reading, and the only shape every one of the four report
 * types can actually be built from (each is scoped to one session).
 */
export class CreateReportDto {
  @IsUUID()
  exam_session_id!: string;

  @IsIn(VALID_FORMATS)
  format!: ReportFormat;
}
