'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Drawer, ErrorState, Pagination, StatusBadge, Textarea } from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useSuspensionRequests } from '@/lib/queries/useSuspensionRequests';
import { useApproveSuspension, useRejectSuspension } from '@/lib/mutations/useSuspensionMutations';
import { mapError } from '@/lib/error-mapping';
import type { SuspensionRequest, SuspensionRequestStatus } from '@/lib/queries/types';

const TABS: { value: SuspensionRequestStatus | ''; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All' },
];

const PAGE_SIZE = 25;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString();

function ReviewDrawer({ request, onClose }: { request: SuspensionRequest; onClose: () => void }) {
  const approve = useApproveSuspension();
  const reject = useRejectSuspension();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = request.status === 'PENDING';
  const busy = approve.isPending || reject.isPending;

  async function run(action: 'approve' | 'reject') {
    setError(null);
    try {
      if (action === 'approve') await approve.mutateAsync({ id: request.id, note: note.trim() || undefined });
      else await reject.mutateAsync({ id: request.id, note: note.trim() });
      onClose();
    } catch (err) {
      setError(mapError(err).description);
    }
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} title="Suspension request" description={request.examSessionName}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={request.status} />
          <StatusBadge status={request.examSessionStatus} />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Exam session</dt>
            <dd className="mt-1 text-text">
              <Link href={`/admin/exam-sessions/${request.examSessionId}`} className="underline">
                {request.examSessionName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Scheduled</dt>
            <dd className="mt-1 text-text">{date(request.examSessionDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Requested by</dt>
            <dd className="mt-1 text-text">
              {request.facultyName} ({request.facultyEmployeeCode})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Requested on</dt>
            <dd className="mt-1 text-text">{dateTime(request.createdAt)}</dd>
          </div>
        </dl>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Faculty&apos;s reason</p>
          <p className="mt-1 whitespace-pre-wrap rounded border border-border bg-surface-muted p-3 text-sm text-text">{request.reason}</p>
        </div>

        {!pending && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {request.status === 'APPROVED' ? 'Approved' : 'Declined'}
              {request.reviewedAt ? ` on ${dateTime(request.reviewedAt)}` : ''}
            </p>
            <p className="mt-1 text-sm text-text">{request.reviewNote || 'No note was added.'}</p>
          </div>
        )}

        {pending && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Alert color="warning" title="Approving cancels this session">
              The session moves to History as cancelled. Its quizzes, rooms, invigilators and seating are released, and assigned
              students are notified. This cannot be undone.
            </Alert>
            {error && <Alert color="danger">{error}</Alert>}
            <Textarea
              label="Note to the faculty member"
              description="Optional when approving. Required when declining — they will see it."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => run('reject')} loading={reject.isPending} disabled={busy || !note.trim()}>
                Decline Request
              </Button>
              <Button variant="destructive" onClick={() => run('approve')} loading={approve.isPending} disabled={busy}>
                Approve &amp; Suspend Session
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/**
 * ADMIN review queue for faculty suspension requests. Pending first; status tabs
 * are real server-side filters and the table is cursor-paginated, so it stays
 * fast however many requests accumulate.
 */
export default function AdminSuspensionRequestsPage() {
  const [status, setStatus] = useState<SuspensionRequestStatus | ''>('PENDING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pager = useCursorPager();

  const { data, isLoading, isError, refetch, isFetching } = useSuspensionRequests({
    status: status || undefined,
    cursor: pager.cursor,
    limit: PAGE_SIZE,
  });
  const items = data?.items ?? [];
  const selected = items.find((r) => r.id === selectedId) ?? null;

  function onTab(next: SuspensionRequestStatus | '') {
    setStatus(next);
    pager.reset();
  }

  const columns: DataTableColumn<SuspensionRequest>[] = [
    {
      key: 'session',
      header: 'Exam Session',
      render: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-text">{r.examSessionName}</span>
          <span className="text-xs text-text-muted">{date(r.examSessionDate)}</span>
        </span>
      ),
    },
    { key: 'faculty', header: 'Requested By', render: (r) => `${r.facultyName} (${r.facultyEmployeeCode})` },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 max-w-sm">{r.reason}</span> },
    { key: 'requested', header: 'Requested', render: (r) => dateTime(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Suspension Requests</h1>
        <p className="text-sm text-text-muted">
          Faculty ask to suspend sessions they no longer need to conduct. Approving cancels the session and frees its resources.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1" role="tablist" aria-label="Filter by status">
        {TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => onTab(tab.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              status === tab.value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState title="Couldn't load suspension requests" onRetry={() => refetch()} retrying={isFetching} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            getRowKey={(r) => r.id}
            isLoading={isLoading}
            isError={false}
            emptyTitle={status === 'PENDING' ? 'No requests waiting for review' : 'No suspension requests here'}
            emptyDescription={status === 'PENDING' ? 'New requests from faculty will appear here.' : 'Try another status.'}
            renderActions={(r) => (
              <Button size="sm" variant={r.status === 'PENDING' ? 'primary' : 'secondary'} onClick={() => setSelectedId(r.id)}>
                {r.status === 'PENDING' ? 'Review' : 'View'}
              </Button>
            )}
          />
          <Pagination
            hasNext={!!data?.next_cursor}
            hasPrev={pager.hasPrev}
            onNext={() => pager.goNext(data?.next_cursor)}
            onPrev={pager.goPrev}
          />
        </>
      )}

      {selected && <ReviewDrawer request={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
