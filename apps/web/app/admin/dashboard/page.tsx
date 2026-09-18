'use client';

import { ClipboardList, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiTile, KpiTileSkeleton } from '@/components/dashboard/KpiTile';
import { StatusBreakdown } from '@/components/dashboard/StatusBreakdown';
import { NotificationsPanel } from '@/components/dashboard/NotificationsPanel';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { useQuizzes } from '@/lib/queries/useQuizzes';
import { useIncidents } from '@/lib/queries/useIncidents';
import { mapError } from '@/lib/error-mapping';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * Admin dashboard — real, backend-backed KPIs only.
 *
 * Deliberately OMITTED vs. the architecture doc: an "Active Sessions
 * Today" tile and any "recent session activity" panel. There is no
 * `GET /exam-sessions` list endpoint on the real backend (only
 * `GET /exam-sessions/{id}` by id and its `/conflicts` sub-route) — the
 * frontend has no way to discover or list session ids at all, so building
 * those widgets would mean fabricating data. See the milestone report for
 * the full gap writeup.
 */
export default function AdminDashboardPage() {
  const pendingQuizzes = useQuizzes({ status: 'SUBMITTED', limit: 50 });
  const openIncidents = useIncidents({ status: 'OPEN', limit: 200 });

  const pendingCount = pendingQuizzes.data?.items.length ?? 0;

  const severityCounts = (openIncidents.data?.items ?? []).reduce<Record<string, number>>((acc, inc) => {
    acc[inc.severity] = (acc[inc.severity] ?? 0) + 1;
    return acc;
  }, {});
  const criticalOrHigh = (severityCounts.CRITICAL ?? 0) + (severityCounts.HIGH ?? 0);
  const openIncidentCount = openIncidents.data?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">Admin Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pendingQuizzes.isLoading ? (
          <KpiTileSkeleton />
        ) : pendingQuizzes.isError ? (
          <Card padding="dense">
            <ErrorState
              title="Couldn't load approvals"
              description={mapError(pendingQuizzes.error).description}
              onRetry={() => pendingQuizzes.refetch()}
              retrying={pendingQuizzes.isFetching}
            />
          </Card>
        ) : (
          <KpiTile
            label="Pending Quiz Approvals"
            value={pendingCount}
            icon={<ClipboardList size={18} />}
            tone={pendingCount > 0 ? 'warning' : 'success'}
            description={pendingCount > 0 ? 'Awaiting review' : 'Nothing waiting on you'}
          />
        )}

        {openIncidents.isLoading ? (
          <KpiTileSkeleton />
        ) : openIncidents.isError ? (
          <Card padding="dense">
            <ErrorState
              title="Couldn't load incidents"
              description={mapError(openIncidents.error).description}
              onRetry={() => openIncidents.refetch()}
              retrying={openIncidents.isFetching}
            />
          </Card>
        ) : (
          <KpiTile
            label="Open Incidents"
            value={openIncidentCount}
            icon={<AlertTriangle size={18} />}
            tone={criticalOrHigh > 0 ? 'danger' : openIncidentCount > 0 ? 'warning' : 'success'}
            description={
              openIncidentCount === 0
                ? 'No open incidents — good news'
                : criticalOrHigh > 0
                  ? `${criticalOrHigh} critical/high`
                  : 'None critical or high'
            }
          />
        )}
      </div>

      <Card header={<h2 className="text-sm font-semibold text-text">Open Incidents by Severity</h2>}>
        {openIncidents.isLoading ? (
          <div className="flex gap-3">
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
          </div>
        ) : openIncidents.isError ? (
          <ErrorState
            description={mapError(openIncidents.error).description}
            onRetry={() => openIncidents.refetch()}
            retrying={openIncidents.isFetching}
          />
        ) : openIncidentCount === 0 ? (
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title="No open incidents"
            description="Everything is quiet right now — new incidents will appear here as they're reported."
          />
        ) : (
          <StatusBreakdown
            kind="severity"
            items={SEVERITY_ORDER.filter((s) => severityCounts[s]).map((s) => ({
              status: s,
              count: severityCounts[s],
            }))}
          />
        )}
      </Card>

      <NotificationsPanel />
    </div>
  );
}
