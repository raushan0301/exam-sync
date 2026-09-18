'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch, API_BASE_URL } from '../api-client';
import { getAccessToken } from '../token-storage';
import type { CreateReportJobResult, ReportFormat, ReportType } from '../queries/types';

const REPORT_TYPE_PATHS: Record<ReportType, string> = {
  ATTENDANCE: '/reports/attendance',
  SEATING_PLAN: '/reports/seating-plan',
  INCIDENT_REPORT: '/reports/incident-report',
  ROOM_UTILIZATION: '/reports/room-utilization',
};

export interface CreateReportInput {
  exam_session_id: string;
  format: ReportFormat;
}

/**
 * POST /reports/{type} — ADMIN only. All four report-creation endpoints
 * share the identical `{exam_session_id, format}` body and `202 {job_id}`
 * response shape, so this is one parameterized mutation rather than four
 * copy-pasted ones. No query invalidation on success — there is no
 * report-job list endpoint to invalidate (see the Reports page for the
 * documented gap); callers track the returned `job_id` themselves and feed
 * it to `useReportJob` for live polling.
 */
export function useCreateReport(type: ReportType) {
  return useMutation({
    mutationFn: (input: CreateReportInput) =>
      apiFetch<CreateReportJobResult>(REPORT_TYPE_PATHS[type], { method: 'POST', body: input }),
  });
}

/**
 * GET /report-jobs/{id}/download — raw binary file stream, NOT JSON, so
 * this deliberately bypasses `apiFetch<T>()`'s JSON wrapper. Verified
 * against `ReportsController.download` / `ReportJob`'s schema doc comment:
 * `download_url` is a relative path served by this SAME app (no external
 * object storage / signed URL exists yet), so it still needs the bearer
 * Authorization header like every other route — a plain `<a href>` link
 * can't carry that header, hence blob-fetch -> object URL -> temporary
 * `<a download>` click, then revoke the object URL.
 */
export async function downloadReportJob(jobId: string, suggestedFilename?: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(new URL(`/report-jobs/${jobId}/download`, API_BASE_URL).toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
  }
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? suggestedFilename ?? `report-${jobId}`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Thin mutation wrapper around `downloadReportJob` for loading/error state in components. */
export function useDownloadReportJob() {
  return useMutation({
    mutationFn: ({ jobId, filename }: { jobId: string; filename?: string }) => downloadReportJob(jobId, filename),
  });
}
