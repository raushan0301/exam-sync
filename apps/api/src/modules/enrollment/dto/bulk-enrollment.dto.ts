import { Type } from 'class-transformer';
import { ArrayMinSize, ValidateNested } from 'class-validator';
import { CreateEnrollmentDto } from './create-enrollment.dto';

/**
 * API_CONTRACT.md: `POST /enrollments/bulk` body "array or CSV". This
 * phase implements the JSON-array form only — CSV multipart parsing (per
 * Phase 3's students bulk-import precedent) is straightforward to add
 * later but the contract explicitly offers a choice ("or"), and a JSON
 * array is sufficient to satisfy EC-044's per-row partial-failure
 * requirement without re-deriving multipart-upload plumbing in this phase.
 */
export class BulkEnrollmentDto {
  @ValidateNested({ each: true })
  @Type(() => CreateEnrollmentDto)
  @ArrayMinSize(1)
  enrollments!: CreateEnrollmentDto[];
}
