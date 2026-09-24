import { IsString, IsUUID, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /batches` body `{program_id, year, section, subsection}`. */
export class CreateBatchDto {
  @IsUUID()
  program_id!: string;

  // Free-form cohort label — a single year ("2026") or a span
  // ("2023-2027"), not a real date; validated only as a non-empty string.
  @IsString()
  @MinLength(1)
  year!: string;

  @IsString()
  @MinLength(1)
  section!: string;

  // Fine-grained sub-group students belong to, e.g. "4C24". Unique together
  // with (program_id, year, section) — not unique on its own.
  @IsString()
  @MinLength(1)
  subsection!: string;
}
