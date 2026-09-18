'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Card,
  StatusBadge,
  Badge,
  Skeleton,
  EmptyState,
  ErrorState,
  Drawer,
  Modal,
  Textarea,
  Button,
  Alert,
} from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { useIncidents, useIncidentHistory } from '@/lib/queries/useIncidents';
import { useUpdateIncidentStatus } from '@/lib/mutations/useIncidentMutations';
import { mapError } from '@/lib/error-mapping';
import { getAvailableActionsForStatus, actionRequiresResolution, INCIDENT_ACTION_LABELS } from '@/lib/incident-workflow';
import type { Incident, IncidentAction, IncidentStatus } from '@/lib/queries/types';
import { INCIDENT_TYPE_OPTIONS } from '@/components/incident/IncidentForm';

const COLUMNS: { status: IncidentStatus; label: string }[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'UNDER_REVIEW', label: 'Under Review' },
  { status: 'ESCALATED', label: 'Escalated' },
  { status: 'RESOLVED', label: 'Resolved' },
  { status: 'DISMISSED', label: 'Dismissed' },
];

function typeLabel(type: string): string {
  return INCIDENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function IncidentCard({ incident, onClick }: { incident: Incident; onClick: () => void }) {
  const critical = incident.severity === 'CRITICAL';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors duration-150 ease hover:bg-neutral-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        critical ? 'border-danger-border border-2' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={incident.severity} />
        {critical && <AlertTriangle size={16} className="text-danger-text" aria-hidden="true" />}
      </div>
      <p className="text-sm font-medium text-text">{typeLabel(incident.incidentType)}</p>
      <p className="line-clamp-2 text-xs text-text-muted">{incident.description}</p>
      <p className="text-[11px] text-text-subtle">{new Date(incident.createdAt).toLocaleDateString()}</p>
    </button>
  );
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
            <p className="mt-1 font-mono text-xs text-text">{incident.examSessionId}</p>
          </div>
          {incident.roomId && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Room</p>
              <p className="mt-1 font-mono text-xs text-text">{incident.roomId}</p>
            </div>
          )}
          {incident.studentId && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student</p>
              <p className="mt-1 font-mono text-xs text-text">{incident.studentId}</p>
            </div>
          )}
          {incident.quizId && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quiz</p>
              <p className="mt-1 font-mono text-xs text-text">{incident.quizId}</p>
            </div>
          )}
        </div>

        {incident.resolution && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Resolution</p>
            <p className="mt-1 text-sm text-text">{incident.resolution}</p>
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

export default function AdminIncidentsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useIncidents({ limit: 100 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const byStatus = (status: IncidentStatus) => items.filter((i) => i.status === status);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Incident Triage</h1>
        <p className="text-sm text-text-muted">All reported incidents, grouped by status.</p>
      </div>

      {isError && <ErrorState title="Couldn't load incidents" onRetry={() => refetch()} retrying={isFetching} />}

      {!isError && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <Card key={col.status} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">{col.label}</h2>
                <Badge color="neutral">{isLoading ? '…' : byStatus(col.status).length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {isLoading &&
                  Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
                {!isLoading && byStatus(col.status).length === 0 && (
                  <EmptyState title={`No ${col.label.toLowerCase()} incidents`} />
                )}
                {!isLoading &&
                  byStatus(col.status).map((incident) => (
                    <IncidentCard key={incident.id} incident={incident} onClick={() => setSelectedId(incident.id)} />
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && <IncidentDetailDrawer incident={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
