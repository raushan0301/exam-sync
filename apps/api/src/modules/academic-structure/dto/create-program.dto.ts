import { IsString, IsUUID, MinLength } from 'class-validator';

/** API_CONTRACT.md: `POST /programs` body `{department_id, name, code}`. */
export class CreateProgramDto {
  @IsUUID()
  department_id!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  code!: string;
}
