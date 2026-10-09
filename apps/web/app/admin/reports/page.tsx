'use client';

import { useState } from 'react';
import { FileDown, RefreshCw } from 'lucide-react';
import { Card, Select, Button, Alert, LoadingState } from '@/components/ui';
import { useCreateReport } from '@/lib/mutations/useReportMutations';
import { useDownloadReportJob } from '@/lib/mutations/useReportMutations';
import { useReportJob } from '@/lib/queries/useReportJob';
import { useExamSessions } from '@/lib/queries/useExamSessions';
import { mapError } from '@/lib/error-mapping';
import type { ReportFormat, ReportType } from '@/lib/queries/types';

const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: 'ATTENDANCE', label: 'Attendance Report' },
  { value: 'SEATING_PLAN', label: 'Seating Plan Report' },
  { value: 'INCIDENT_REPORT', label: 'Incident Report' },
  { value: 'ROOM_UTILIZATION', label: 'Room Utilization Report' },
];

const FORMAT_OPTIONS: { value: ReportFormat; label: string }[] = [
  { value: 'CSV', label: 'CSV' },
  { value: 'EXCEL', label: 'Excel' },
];

/**
 * Report generation — ADMIN only. All four `POST /reports/{type}` endpoints
 * share the identical `{exam_session_id, format}` body, so `useCreateReport`
 * is a single parameterized mutation switched by the selected type.
 *
 * The exam session is picked from `GET /exam-sessions` (`useExamSessions`,
 * ADMIN-unscoped — every session, not just ones the admin created) rather
 * than typed as a raw UUID: that list endpoint already existed and is used
 * elsewhere (`app/admin/exam-sessions/page.tsx`), this page just never
 * called it.
 *
 * There is also deliberately NO report-job history/list below the form:
 * `GET /report-jobs/{id}` is the only report-job read endpoint that exists
 * — there is no way to list past jobs. The flow is create -> immediately
 * shown that one job's live status (polled via `useReportJob`'s real
 * `refetchInterval`, unlike M7-M9's fake-202-but-synchronous endpoints)
 * until it reaches a terminal state.
 */
export default function AdminReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('ATTENDANCE');
  const [examSessionId, setExamSessionId] = useState('');
  const [format, setFormat] = useState<ReportFormat>('CSV');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const createReport = useCreateReport(reportType);
  const download = useDownloadReportJob();
  const job = useReportJob(activeJobId);
  const examSessionsQuery = useExamSessions({ limit: 200 });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    if (!examSessionId) {
      setValidationError('Select an exam session.');
      return;
    }
    try {
      const result = await createReport.mutateAsync({ exam_session_id: examSessionId, format });
      setActiveJobId(result.job_id);
    } catch {
      // surfaced via createReport.isError below
    }
  }

  function handleRetry() {
    setActiveJobId(null);
    createReport.reset();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Reports</h1>
        <p className="mt-1 text-sm text-text-muted">
          Generate a report for an exam session. There is no history of past reports — each generation shows its own
          live job status below until it completes.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Select
            label="Report type"
            id="report-type"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            options={REPORT_TYPE_OPTIONS}
          />
          <Select
            label="Exam session"
            id="exam-session-id"
            value={examSessionId}
            onChange={(e) => setExamSessionId(e.target.value)}
            options={(examSessionsQuery.data?.items ?? []).map((s) => ({
              value: s.id,
              label: `${s.name} · ${s.sessionDate.slice(0, 10)}`,
            }))}
            placeholder={examSessionsQuery.isLoading ? 'Loading exam sessions…' : 'Select an exam session'}
            disabled={examSessionsQuery.isLoading}
            error={validationError ?? undefined}
            required
          />
          <Select
            label="Format"
            id="report-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ReportFormat)}
            options={FORMAT_OPTIONS}
          />
          {createReport.isError && (
            <Alert color="danger" title={mapError(createReport.error).title}>
              {mapError(createReport.error).description}
            </Alert>
          )}
          <div>
            <Button type="submit" disabled={createReport.isPending}>
              {createReport.isPending ? 'Starting…' : 'Generate report'}
            </Button>
          </div>
        </form>
      </Card>

      {activeJobId && (
        <Card header={<h2 className="text-sm font-semibold text-text">Report status</h2>}>
          {job.isLoading && <LoadingState label="Fetching job status…" />}

          {job.data && (job.data.status === 'PENDING' || job.data.status === 'RUNNING') && (
            <div className="flex flex-col items-center gap-3 py-8 text-text-muted" role="status">
              <RefreshCw className="animate-spin" size={22} aria-hidden="true" />
              <p className="text-sm">
                {job.data.status === 'PENDING' ? 'Report queued…' : 'Report is generating…'} This updates automatically.
              </p>
            </div>
          )}

          {job.data?.status === 'COMPLETED' && (
            <div className="flex flex-col items-start gap-3 py-4">
              <Alert color="success" title="Report ready">
                Your {REPORT_TYPE_OPTIONS.find((o) => o.value === reportType)?.label.toLowerCase()} has finished
                generating.
              </Alert>
              <Button
                leadingIcon={<FileDown size={16} aria-hidden="true" />}
                onClick={() => download.mutate({ jobId: activeJobId })}
                disabled={download.isPending}
              >
                {download.isPending ? 'Downloading…' : 'Download'}
              </Button>
              {download.isError && (
                <Alert color="danger" title="Download failed">
                  {mapError(download.error).description}
                </Alert>
              )}
            </div>
          )}

          {job.data?.status === 'FAILED' && (
            <div className="flex flex-col items-start gap-3 py-4">
              <Alert color="danger" title="Report generation failed">
                {job.data.error_message ?? 'The report job failed for an unknown reason.'}
              </Alert>
              <Button variant="secondary" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
