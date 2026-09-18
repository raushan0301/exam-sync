'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Card, Input, Badge, Drawer, Button, Pagination, FilterBar, DateRangeInput } from '@/components/ui';
import { DataTable } from '@/components/data-table/DataTable';
import { useAuditLogs } from '@/lib/queries/useAuditLogs';
import { mapError } from '@/lib/error-mapping';
import type { AuditLogEntry } from '@/lib/queries/types';

function actionColor(action: AuditLogEntry['action']): 'success' | 'info' | 'warning' | 'danger' {
  switch (action) {
    case 'CREATE':
      return 'success';
    case 'UPDATE':
      return 'info';
    case 'REACTIVATE':
      return 'success';
    case 'DEACTIVATE':
      return 'warning';
    default:
      return 'info';
  }
}

/** Union of both objects' keys, in insertion order (old first, then any new-only keys). */
function unionKeys(oldValue: Record<string, unknown> | null, newValue: Record<string, unknown> | null): string[] {
  const keys = new Set<string>();
  Object.keys(oldValue ?? {}).forEach((k) => keys.add(k));
  Object.keys(newValue ?? {}).forEach((k) => keys.add(k));
  return Array.from(keys);
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function AuditDiff({ entry }: { entry: AuditLogEntry }) {
  const keys = unionKeys(entry.oldValue, entry.newValue);
  if (keys.length === 0) {
    return <p className="text-sm text-text-muted">No field-level changes recorded.</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-border rounded-md border border-border">
      {keys.map((key) => {
        const oldV = entry.oldValue?.[key];
        const newV = entry.newValue?.[key];
        const changed = JSON.stringify(oldV) !== JSON.stringify(newV);
        return (
          <div key={key} className={changed ? 'bg-warning-bg/40' : undefined}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3 py-2 text-xs">
              <div className="col-span-3 font-medium text-text">{key}</div>
              <div className="break-all text-text-muted">{formatValue(oldV)}</div>
              <div className="text-text-subtle">→</div>
              <div className="break-all text-text">{formatValue(newV)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="tertiary"
      leadingIcon={<Copy size={14} aria-hidden="true" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable — no-op, nothing to surface here
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * Audit Log (Milestone 11). ADMIN only (BR-047), already gated by
 * /admin/** RoleGate. Exactly one endpoint (`GET /audit-logs`) — no
 * `GET /audit-logs/{id}` exists, so the list row itself carries the full
 * detail shown in the drawer (verified against audit-logs.controller.ts).
 * No actor-name lookup exists anywhere in the backend, so `actorId` is
 * rendered as a raw id, never joined against a fabricated name.
 */
export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useAuditLogs({
    cursor,
    limit: 20,
    entity_type: entityType || undefined,
    entity_id: entityId || undefined,
    actor_id: actorId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  function resetToFirstPage() {
    setCursor(undefined);
    setCursorHistory([]);
  }

  function goNext() {
    if (!data?.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? '']);
    setCursor(data.next_cursor);
  }
  function goPrev() {
    setCursorHistory((h) => {
      const next = [...h];
      const prev = next.pop();
      setCursor(prev ? prev : undefined);
      return next;
    });
  }

  const items = data?.items ?? [];
  const mapped = isError ? mapError(error) : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Audit Log</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every CREATE / UPDATE / DEACTIVATE / REACTIVATE recorded across the system.
        </p>
      </div>

      <FilterBar>
        <Input
          label="Entity type"
          placeholder="e.g. Quiz"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          onBlur={resetToFirstPage}
        />
        <Input
          label="Entity ID"
          placeholder="UUID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          onBlur={resetToFirstPage}
        />
        <Input
          label="Actor ID"
          placeholder="UUID"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          onBlur={resetToFirstPage}
        />
        <DateRangeInput
          start={dateFrom}
          end={dateTo}
          onStartChange={(v) => {
            setDateFrom(v);
            resetToFirstPage();
          }}
          onEndChange={(v) => {
            setDateTo(v);
            resetToFirstPage();
          }}
        />
      </FilterBar>

      <Card className="p-0 overflow-hidden">
        <DataTable<AuditLogEntry>
          columns={[
            { key: 'createdAt', header: 'Time', render: (r) => new Date(r.createdAt).toLocaleString() },
            { key: 'action', header: 'Action', render: (r) => <Badge color={actionColor(r.action)}>{r.action}</Badge> },
            { key: 'entityType', header: 'Entity', render: (r) => `${r.entityType} / ${r.entityId.slice(0, 8)}…` },
            { key: 'actorId', header: 'Actor', render: (r) => <span className="font-mono text-xs">{r.actorId.slice(0, 8)}…</span> },
            { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' },
          ]}
          data={items}
          getRowKey={(r) => r.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          retrying={isFetching}
          errorTitle={mapped?.title}
          errorDescription={mapped?.description}
          emptyTitle="No audit log entries match these filters"
          emptyDescription="Try widening your filters or date range."
          renderActions={(r) => (
            <Button size="sm" variant="tertiary" onClick={() => setSelected(r)}>
              View
            </Button>
          )}
        />
      </Card>

      <Pagination hasNext={!!data?.next_cursor} hasPrev={cursorHistory.length > 0} onNext={goNext} onPrev={goPrev} />

      {selected && (
        <Drawer open onOpenChange={(open) => !open && setSelected(null)} title="Audit Log Entry" description={`${selected.entityType} · ${selected.action}`}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Actor</p>
                <p className="mt-1 font-mono text-xs text-text">{selected.actorId}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Action</p>
                <p className="mt-1"><Badge color={actionColor(selected.action)}>{selected.action}</Badge></p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Entity type</p>
                <p className="mt-1 text-text">{selected.entityType}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Entity ID</p>
                <p className="mt-1 font-mono text-xs text-text">{selected.entityId}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Timestamp</p>
                <p className="mt-1 text-text">{new Date(selected.createdAt).toLocaleString()}</p>
              </div>
              {selected.academicYear != null && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Academic year</p>
                  <p className="mt-1 text-text">{selected.academicYear}</p>
                </div>
              )}
            </div>

            {selected.requestId && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Request ID</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-text">{selected.requestId}</span>
                  <CopyButton value={selected.requestId} />
                </div>
              </div>
            )}

            {selected.reason && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Reason</p>
                <p className="mt-1 text-sm text-text">{selected.reason}</p>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Change diff</p>
              <AuditDiff entry={selected} />
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
