'use client';

import { FileText, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBreakdown } from '@/components/dashboard/StatusBreakdown';
import { NotificationsPanel } from '@/components/dashboard/NotificationsPanel';
import { useQuizzes } from '@/lib/queries/useQuizzes';
import { useIncidents } from '@/lib/queries/useIncidents';
import { mapError } from '@/lib/error-mapping';
import type { QuizStatus } from '@/lib/queries/types';

const QUIZ_STATUS_ORDER: QuizStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

/**
 * Faculty dashboard — "my quizzes by status" and "my reported incidents"
 * are real, backed by GET /quizzes and GET /incidents, both of which
 * self-scope to the calling FACULTY actor server-side (no client filter
 * needed). Fetched unfiltered and bucketed client-side rather than one
 * call per status, since a faculty member's own quiz count is small.
 *
 * Deliberately OMITTED vs. the architecture doc: "My Assignments," "My
 * Invigilation Duties," and "Exam Sessions" sections. Those need either a
 * faculty-domain-entity id (GET /users/me only returns the User row id,
 * not the Faculty row id that GET /faculty/{id}/assignments etc. require)
 * or a GET /exam-sessions list endpoint — neither exists on the real
 * backend today. See the milestone report for the full gap writeup.
 */
export default function FacultyDashboardPage() {
  const myQuizzes = useQuizzes({ limit: 200 });
  const myIncidents = useIncidents({ limit: 200 });

  const quizStatusCounts = (myQuizzes.data?.items ?? []).reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {});
  const totalQuizzes = myQuizzes.data?.items.length ?? 0;

  const incidentStatusCounts = (myIncidents.data?.items ?? []).reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});
  const totalIncidents = myIncidents.data?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">Faculty Dashboard</h1>

      <Card header={<h2 className="text-sm font-semibold text-text">My Quizzes by Status</h2>}>
        {myQuizzes.isLoading ? (
          <div className="flex gap-3">
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
          </div>
        ) : myQuizzes.isError ? (
          <ErrorState
            description={mapError(myQuizzes.error).description}
            onRetry={() => myQuizzes.refetch()}
            retrying={myQuizzes.isFetching}
          />
        ) : totalQuizzes === 0 ? (
          <EmptyState
            icon={<FileText size={28} />}
            title="No quizzes yet"
            description="Quizzes you create will show up here, grouped by status."
          />
        ) : (
          <StatusBreakdown
            items={QUIZ_STATUS_ORDER.filter((s) => quizStatusCounts[s]).map((s) => ({
              status: s,
              count: quizStatusCounts[s],
            }))}
          />
        )}
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">My Reported Incidents</h2>}>
        {myIncidents.isLoading ? (
          <div className="flex gap-3">
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-200" />
          </div>
        ) : myIncidents.isError ? (
          <ErrorState
            description={mapError(myIncidents.error).description}
            onRetry={() => myIncidents.refetch()}
            retrying={myIncidents.isFetching}
          />
        ) : totalIncidents === 0 ? (
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title="No incidents reported"
            description="Incidents you report during an exam session will appear here."
          />
        ) : (
          <StatusBreakdown
            items={Object.entries(incidentStatusCounts).map(([status, count]) => ({ status, count }))}
          />
        )}
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Invigilation Duties</h2>}>
        <EmptyState
          icon={<ClipboardCheck size={28} />}
          title="Coming soon"
          description="Invigilation duties aren't available yet — the backend doesn't currently expose a way to resolve your faculty profile from your login, which this feature depends on."
        />
      </Card>

      <NotificationsPanel />
    </div>
  );
}
