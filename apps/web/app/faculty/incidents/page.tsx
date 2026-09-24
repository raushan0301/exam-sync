'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, StatusBadge, Select, FilterBar, Drawer } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useIncidents } from '@/lib/queries/useIncidents';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/queries/types';
import { INCIDENT_TYPE_OPTIONS, SEVERITY_OPTIONS } from '@/components/incident/IncidentForm';

const STATUS_OPTIONS: { value: IncidentStatus; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'ESCALATED', label: 'Escalated' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

function typeLabel(type: string): string {
  return INCIDENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/**
 * FACULTY "My Reported Incidents" — GET /incidents self-scopes server-side
 * to incidents this faculty member reported. Detail view is deliberately
 * read-only: no status-transition actions and no history timeline (that
 * history endpoint is @Roles(ROLE.ADMIN)-gated and would 403 for a
 * faculty caller, so this view never calls useIncidentHistory).
 */
export default function FacultyIncidentsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const [selected, setSelected] = useState<Incident | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useIncidents({
    status: (status || undefined) as IncidentStatus | undefined,
    severity: (severity || undefined) as IncidentSeverity | undefined,
    limit: 50,
  });

  const columns: DataTableColumn<Incident>[] = [
    { key: 'type', header: 'Type', render: (i) => typeLabel(i.incidentType) },
    { key: 'severity', header: 'Severity', render: (i) => <StatusBadge status={i.severity} /> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'description', header: 'Description', render: (i) => <span className="line-clamp-1">{i.description}</span> },
    { key: 'createdAt', header: 'Reported', render: (i) => new Date(i.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">My Reported Incidents</h1>
          <p className="text-sm text-text-muted">Incidents you&apos;ve reported across your invigilation duties.</p>
        </div>
        <Button onClick={() => router.push('/faculty/incidents/new')}>Report Incident</Button>
      </div>

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          containerClassName="w-48"
        />
        <Select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          options={SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          placeholder="All severities"
          containerClassName="w-48"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowKey={(i) => i.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load your incidents"
        emptyTitle="No incidents reported yet"
        emptyDescription="When you report an incident during invigilation, it will show up here."
        emptyAction={<Button onClick={() => router.push('/faculty/incidents/new')}>Report Incident</Button>}
        renderActions={(i) => (
          <Button size="sm" variant="secondary" onClick={() => setSelected(i)}>
            View
          </Button>
        )}
      />

      <Drawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title="Incident Detail"
        description={selected ? typeLabel(selected.incidentType) : undefined}
      >
        {selected && (
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.severity} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Description</p>
              <p className="mt-1 text-sm text-text">{selected.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Exam Session</p>
                <p className="mt-1 text-text">{selected.examSessionName}</p>
              </div>
              {selected.roomLabel && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Room</p>
                  <p className="mt-1 text-text">{selected.roomLabel}</p>
                </div>
              )}
              {selected.studentLabel && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student</p>
                  <p className="mt-1 text-text">{selected.studentLabel}</p>
                </div>
              )}
              {selected.quizTitle && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quiz</p>
                  <p className="mt-1 text-text">{selected.quizTitle}</p>
                </div>
              )}
            </div>
            {selected.resolution && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Resolution</p>
                <p className="mt-1 text-sm text-text">{selected.resolution}</p>
              </div>
            )}
            <p className="text-xs text-text-subtle">
              Reported {new Date(selected.createdAt).toLocaleString()}. Status changes are handled by an
              administrator — you&apos;ll see the status update here once reviewed.
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
