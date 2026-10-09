'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Card,
  StatusBadge,
  Skeleton,
  ErrorState,
  Drawer,
  Modal,
  Textarea,
  Button,
  Select,
  FilterBar,
  Pagination,
  Alert,
} from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useIncidents, useIncidentHistory } from '@/lib/queries/useIncidents';
import { useUpdateIncidentStatus } from '@/lib/mutations/useIncidentMutations';
import { mapError } from '@/lib/error-mapping';
import { getAvailableActionsForStatus, actionRequiresResolution, INCIDENT_ACTION_LABELS } from '@/lib/incident-workflow';
import type { Incident, IncidentAction, IncidentSeverity, IncidentStatus } from '@/lib/queries/types';
import { INCIDENT_TYPE_OPTIONS, SEVERITY_OPTIONS } from '@/components/incident/IncidentForm';
import { IncidentSeatHighlight } from '@/components/incident/IncidentSeatHighlight';

const STATUS_TABS: { value: IncidentStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'ESCALATED', label: 'Escalated' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

function typeLabel(type: string): string {
  return INCIDENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

interface PendingAction {
  action: IncidentAction;
}

function IncidentDetailDrawer({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const { data: history, isLoading: historyLoading } = useIncidentHistory(incident.id);
  const updateStatus = useUpdateIncidentStatus(incident.id);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [resolution, setResolution] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const availableActions = getAvailableActionsForStatus(incident.status);

  function openAction(action: IncidentAction) {
    setPending({ action });
    setResolution('');
    setNotes('');
    setFormError(null);
  }

  async function confirmAction() {
    if (!pending) return;
    const requiresResolution = actionRequiresResolution(pending.action);
    if (requiresResolution && resolution.trim().length === 0) {
      setFormError('A resolution note is required for this action.');
      return;
    }
    try {
      await updateStatus.mutateAsync({
        action: pending.action,
        resolution: requiresResolution ? resolution : undefined,
        notes: notes || undefined,
      });
      setPending(null);
    } catch (err) {
      setFormError(mapError(err).description);
    }
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} title="Incident Detail" description={typeLabel(incident.incidentType)}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={incident.status} />
          <StatusBadge status={incident.severity} />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Description</p>
          <p className="mt-1 text-sm text-text">{incident.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Exam Session</p>
            <p className="mt-1 text-text">{incident.examSessionName}</p>
          </div>
          {incident.roomLabel && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Room</p>
              <p className="mt-1 text-text">{incident.roomLabel}</p>
            </div>
          )}
          {incident.studentLabel && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student</p>
              <p className="mt-1 text-text">{incident.studentLabel}</p>
            </div>
          )}
          {incident.quizTitle && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quiz</p>
              <p className="mt-1 text-text">{incident.quizTitle}</p>
            </div>
          )}
        </div>

        {incident.resolution && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Resolution</p>
            <p className="mt-1 text-sm text-text">{incident.resolution}</p>
          </div>
        )}

        {incident.roomId && incident.seatId && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Seat</p>
            <IncidentSeatHighlight roomId={incident.roomId} seatId={incident.seatId} studentLabel={incident.studentLabel} />
          </div>
        )}

        {availableActions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {availableActions.map((action) => (
              <Button key={action} size="sm" variant={action === 'ESCALATE' ? 'destructive' : 'primary'} onClick={() => openAction(action)}>
                {INCIDENT_ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">History</p>
          {historyLoading && <Skeleton className="h-16 w-full" />}
          {!historyLoading && (!history || history.length === 0) && (
            <p className="text-sm text-text-muted">No history yet.</p>
          )}
          {!historyLoading && history && history.length > 0 && (
            <ol className="flex flex-col gap-3">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{h.action}</span>
                    <span className="text-text-subtle">
                      {h.previousStatus ? `${h.previousStatus} → ${h.newStatus}` : h.newStatus}
                    </span>
                  </div>
                  {h.resolution && <p className="text-xs text-text-muted">Resolution: {h.resolution}</p>}
                  {h.notes && <p className="text-xs text-text-muted">Notes: {h.notes}</p>}
                  <p className="text-[11px] text-text-subtle">{new Date(h.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {pending && (
        <Modal
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={`${INCIDENT_ACTION_LABELS[pending.action]} incident`}
          description={`This will move the incident from ${incident.status} via ${pending.action}.`}
          preventDismiss={pending.action === 'DISMISS' || pending.action === 'ESCALATE'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={updateStatus.isPending}>
                Cancel
              </Button>
              <Button
                variant={pending.action === 'DISMISS' || pending.action === 'ESCALATE' ? 'destructive' : 'primary'}
                onClick={confirmAction}
                loading={updateStatus.isPending}
              >
                {INCIDENT_ACTION_LABELS[pending.action]}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {formError && <Alert color="danger">{formError}</Alert>}
            {actionRequiresResolution(pending.action) && (
              <Textarea
                label="Resolution"
                required
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Describe how this incident was resolved."
              />
            )}
            <Textarea
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context for this transition."
            />
          </div>
        </Modal>
      )}
    </Drawer>
  );
}

const PAGE_SIZE = 25;

/**
 * Admin incident triage — a filtered, cursor-paginated table, not an
 * unbounded per-status kanban board. The old version fetched a flat
 * `limit: 100` and split it into 5 status columns client-side: at 10k+
 * incidents that (a) only ever showed the newest 100 incidents total no
 * matter which status column you looked at, and (b) rendered every one of
 * those 100 as its own card, all at once, with no way to page further.
 * Status/severity are now real server-side filters (`GET /incidents`
 * already supported both — see `incidents.service.ts`'s `list()` — the old
 * UI just never used them), each status tab and severity change resets
 * pagination (`pager.reset()`) since a filter change invalidates any cursor
 * from the previous filter's result set.
 */
export default function AdminIncidentsPage() {
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const pager = useCursorPager();

  const { data, isLoading, isError, refetch, isFetching } = useIncidents({
    status: status || undefined,
    severity: severity || undefined,
    cursor: pager.cursor,
    limit: PAGE_SIZE,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  function onStatusChange(next: IncidentStatus | '') {
    setStatus(next);
    pager.reset();
  }

  function onSeverityChange(next: IncidentSeverity | '') {
    setSeverity(next);
    pager.reset();
  }

  const columns: DataTableColumn<Incident>[] = [
    {
      key: 'severity',
      header: 'Severity',
      render: (i) => (
        <span className="flex items-center gap-1.5">
          {i.severity === 'CRITICAL' && <AlertTriangle size={14} className="text-danger-text" aria-hidden="true" />}
          <StatusBadge status={i.severity} />
        </span>
      ),
    },
    { key: 'type', header: 'Type', render: (i) => typeLabel(i.incidentType) },
    { key: 'description', header: 'Description', render: (i) => <span className="line-clamp-1 max-w-xs">{i.description}</span> },
    { key: 'session', header: 'Exam Session', render: (i) => i.examSessionName },
    { key: 'room', header: 'Room', render: (i) => i.roomLabel ?? '—' },
    { key: 'student', header: 'Student', render: (i) => i.studentLabel ?? '—' },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'reported', header: 'Reported', render: (i) => new Date(i.createdAt).toLocaleString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Incident Triage</h1>
        <p className="text-sm text-text-muted">All reported incidents. Filter by status or severity — critical incidents are flagged.</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1" role="tablist" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => onStatusChange(tab.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              status === tab.value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterBar>
        <Select
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value as IncidentSeverity | '')}
          options={[{ value: '', label: 'All severities' }, ...SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
          containerClassName="w-48"
        />
      </FilterBar>

      {isError ? (
        <ErrorState title="Couldn't load incidents" onRetry={() => refetch()} retrying={isFetching} />
      ) : isLoading && items.length === 0 ? (
        <Card>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            getRowKey={(i) => i.id}
            isLoading={isLoading}
            isError={isError}
            errorTitle="Couldn't load incidents"
            emptyTitle="No incidents match these filters"
            emptyDescription="Try a different status or severity."
            rowClassName={(i) => (i.severity === 'CRITICAL' ? 'border-l-2 border-l-danger-text bg-danger-bg/40' : undefined)}
            renderActions={(i) => (
              <Button size="sm" variant="secondary" onClick={() => setSelectedId(i.id)}>
                Review
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

      {selected && <IncidentDetailDrawer incident={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
