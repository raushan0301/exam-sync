'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';

export interface DependencyCheck {
  status: 'ok' | 'error';
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
  dependencies: { database: DependencyCheck; redis: DependencyCheck };
}

/** GET /health — public readiness probe (Postgres + Redis). Polled so the page stays live. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'] as const,
    queryFn: () => apiFetch<HealthReport>('/health'),
    enabled: hasStoredSession(),
    refetchInterval: 10_000,
    retry: false,
  });
}
