'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { Incident, IncidentAction, IncidentSeverity, IncidentType } from '../queries/types';

export interface CreateIncidentInput {
  exam_session_id: string;
  quiz_id?: string;
  student_id?: string;
  room_id?: string;
  seat_id?: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  description: string;
}

/**
 * POST /incidents — FACULTY only. Authorization (BR-037) requires the
 * acting faculty to hold an exam_invigilators row for the named session
 * (and room, if given) — a 403 here is expected for a faculty member not
 * invigilating that session and is surfaced via error-mapping.ts rather
 * than pre-validated client-side.
 */
export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIncidentInput) => apiFetch<Incident>('/incidents', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', 'list'] });
    },
  });
}

export interface UpdateIncidentStatusInput {
  action: IncidentAction;
  /** Required by the server (422) for RESOLVE/DISMISS; always optional for INVESTIGATE/ESCALATE. */
  resolution?: string;
  notes?: string;
}

/**
 * PATCH /incidents/{id}/status — ADMIN only. A transition not valid from
 * the incident's current status 409s with a message naming the current
 * status and the rejected action — `getAvailableActionsForStatus` (see
 * incident-workflow.ts) is the frontend's own copy of this same graph so
 * invalid actions are never offered in the first place, and this mutation
 * still surfaces the 409 gracefully as a backstop via error-mapping.ts.
 */
export function useUpdateIncidentStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIncidentStatusInput) =>
      apiFetch<Incident>(`/incidents/${id}/status`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.incident(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.incidentHistory(id) });
    },
  });
}
