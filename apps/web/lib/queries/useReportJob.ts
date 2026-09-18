'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from './queryKeys';
import type { ReportJob } from './types';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

export interface UseReportJobOptions {
  /** Poll interval in ms while PENDING/RUNNING. Default 2500ms. */
  pollIntervalMs?: number;
  enabled?: boolean;
}

/**
 * GET /report-jobs/{id} — ADMIN only. This IS a genuinely async job
 * (unlike M7-M9's "202-but-actually-synchronous" endpoints), so this hook
 * polls for real via `refetchInterval`: a callback that returns the poll
 * interval while `status` is PENDING/RUNNING and `false` once the job has
 * reached a terminal state (COMPLETED/FAILED), stopping the poll loop.
 */
export function useReportJob(id: string | null, options: UseReportJobOptions = {}) {
  const { pollIntervalMs = 2500, enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.reportJob(id ?? ''),
    queryFn: () => apiFetch<ReportJob>(`/report-jobs/${id}`),
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.has(status)) return false;
      return pollIntervalMs;
    },
  });
}
