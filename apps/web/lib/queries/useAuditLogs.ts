'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AuditLogEntry, PaginatedResult } from './types';

export interface UseAuditLogsParams {
  cursor?: string;
  limit?: number;
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  date_from?: string;
  date_to?: string;
}

/** GET /audit-logs — ADMIN only, paginated + filterable. */
export function useAuditLogs(params: UseAuditLogsParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    entity_type: params.entity_type || undefined,
    entity_id: params.entity_id || undefined,
    actor_id: params.actor_id || undefined,
    date_from: params.date_from || undefined,
    date_to: params.date_to || undefined,
  };

  return useQuery({
    queryKey: queryKeys.auditLogs(query),
    queryFn: () => apiFetch<PaginatedResult<AuditLogEntry>>('/audit-logs', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
