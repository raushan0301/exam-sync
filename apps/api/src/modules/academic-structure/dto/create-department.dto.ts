import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /departments` body `{name, code}`. */
export class CreateDepartmentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
