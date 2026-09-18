import { IsIn, IsOptional, IsString } from 'class-validator';
import { IncidentAction } from '@exam-sync/db';

/** The 4 actions API_CONTRACT.md's `PATCH /incidents/{id}/status` literally documents — `CREATE` is internal-only (the row `IncidentsService.create` writes itself), never a client-supplied action. */
const VALID_ACTIONS: IncidentAction[] = [
  IncidentAction.INVESTIGATE,
  IncidentAction.ESCALATE,
  IncidentAction.RESOLVE,
  IncidentAction.DISMISS,
];

/** `PATCH /incidents/{id}/status` — API_CONTRACT.md: body `{action, resolution?, notes?}`; `resolution` is required only for RESOLVE/DISMISS (422 if missing — checked in the service, same "conditionally required" split as `UpdateAttendanceDto.reason`). */
export class UpdateIncidentStatusDto {
  @IsIn(VALID_ACTIONS)
  action!: IncidentAction;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
