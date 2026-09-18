import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class UpdateSubjectDto {
  @IsOptional()
  @IsUUID()
  department_id?: string;

  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  credits?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
