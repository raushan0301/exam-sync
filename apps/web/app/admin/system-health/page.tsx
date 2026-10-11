'use client';

import { RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Card, SkeletonText } from '@/components/ui';
import { useHealth, type DependencyCheck } from '@/lib/queries/useHealth';

function CheckRow({ label, description, check }: { label: string; description: string; check: DependencyCheck | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
        {check?.status === 'error' && check.error && <p className="mt-1 text-xs text-danger-text">{check.error}</p>}
      </div>
      {check ? (
        <Badge color={check.status === 'ok' ? 'success' : 'danger'}>{check.status === 'ok' ? 'Healthy' : 'Down'}</Badge>
      ) : (
        <Badge color="danger">Unreachable</Badge>
      )}
    </div>
  );
}

export default function AdminSystemHealthPage() {
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useHealth();

  const apiUp = !!data;
  const allOk = data?.status === 'ok';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">System Health</h1>
          <p className="text-sm text-text-muted">Live status of the services Exam-Sync depends on. Refreshes every 10 seconds.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching} leadingIcon={<RefreshCw size={14} aria-hidden="true" />}>
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <SkeletonText lines={4} />
        </Card>
      ) : (
        <>
          {allOk ? (
            <Alert color="success" title="All systems operational">Every dependency is responding.</Alert>
          ) : apiUp ? (
            <Alert color="danger" title="Degraded">One or more dependencies are not responding. Features that rely on them (e.g. report generation needs Redis) may fail.</Alert>
          ) : (
            <Alert color="danger" title="API unreachable">The API did not respond{isError ? '' : '.'} Check that the server is running.</Alert>
          )}

          <Card padding="dense">
            <div className="divide-y divide-border">
              <CheckRow label="API server" description="NestJS application process" check={apiUp ? { status: 'ok' } : null} />
              <CheckRow label="Database" description="PostgreSQL (Supabase)" check={data?.dependencies.database ?? null} />
              <CheckRow label="Redis" description="Job queue for reports and notifications" check={data?.dependencies.redis ?? null} />
            </div>
          </Card>

          {dataUpdatedAt > 0 && (
            <p className="text-xs text-text-subtle">Last checked {new Date(dataUpdatedAt).toLocaleTimeString()}</p>
          )}
        </>
      )}
    </div>
  );
}
