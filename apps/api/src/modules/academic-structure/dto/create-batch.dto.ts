import { IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /batches` body `{program_id, year, section}`. */
export class CreateBatchDto {
  @IsUUID()
  program_id!: string;

  @IsInt()
  @Min(1900)
  year!: number;

  @IsString()
  @MinLength(1)
  section!: string;
}
