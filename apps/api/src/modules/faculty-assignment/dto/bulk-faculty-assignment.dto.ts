import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { CreateFacultyAssignmentDto } from './create-faculty-assignment.dto';

/** `POST /faculty-assignments/bulk` — many assignments in one request, processed per row (one bad row never blocks the rest). */
export class BulkFacultyAssignmentDto {
  @ValidateNested({ each: true })
  @Type(() => CreateFacultyAssignmentDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  assignments!: CreateFacultyAssignmentDto[];
}
