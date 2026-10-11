'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { Incident, IncidentHistoryEntry, IncidentSeverity, IncidentStatus } from './types';

export interface UseIncidentsParams {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  examSessionId?: string;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for views that must show/count all rows. */
  all?: boolean;
}

/**
 * GET /incidents — self-scoped server-side (FACULTY sees only incidents
 * they reported, ADMIN sees all, optionally filtered by status/severity).
 */
export function useIncidents(params: UseIncidentsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    severity: params.severity,
    exam_session_id: params.examSessionId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.incidents(query),
    queryFn: () => fetchList<Incident>('/incidents', query),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}

/**
 * GET /incidents/{id}/history — ADMIN only (@Roles(ROLE.ADMIN) on the real
 * controller). FACULTY-facing incident detail must never call this hook —
 * it would 403.
 */
export function useIncidentHistory(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.incidentHistory(id ?? ''),
    queryFn: () => apiFetch<IncidentHistoryEntry[]>(`/incidents/${id}/history`),
    enabled: hasStoredSession() && !!id,
    staleTime: 10_000,
  });
}
