'use client';

import { useState } from 'react';
import { Alert, Button, Card, ConfirmationDialog, EmptyState, ErrorState, Select, SkeletonText, StatusBadge } from '@/components/ui';
import { SeatMap } from '@/components/seating/SeatMap';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { useSeatingJob } from '@/lib/queries/useSeatingJob';
import { useGenerateSeating, useFinalizeSeatingPlan, isFinalizeHardViolations409 } from '@/lib/mutations/useSeatingMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, ExamSessionRoom, SeatingStrategyName } from '@/lib/queries/types';

const STRATEGY_OPTIONS: { value: SeatingStrategyName; label: string; description: string }[] = [
  { value: 'SEQUENTIAL', label: 'Sequential', description: 'Fills seats row by row, in roster order.' },
  { value: 'RANDOMIZED', label: 'Randomized', description: 'Assigns seats in a random, reproducible order.' },
  { value: 'ALTERNATE_SUBJECT', label: 'Alternate Subject', description: 'Alternates neighboring seats between different subjects where possible.' },
  { value: 'ALTERNATE_BATCH', label: 'Alternate Batch', description: 'Alternates neighboring seats between different student batches where possible.' },
  { value: 'SUBJECT_BATCH_MIX', label: 'Subject + Batch Mix', description: 'Balances both subject and batch diversity between neighbors.' },
  { value: 'ANTI_CHEATING', label: 'Anti-Cheating', description: 'Maximizes neighbor diversity to reduce opportunistic copying risk.' },
];

const READ_ONLY_STATUSES = new Set(['FINALIZED', 'SUPERSEDED']);

/**
 * One seating card per room allocated to this session. Each room's plan
 * (if any) is looked up independently via `useSeatingPlan` keyed by a
 * locally-tracked planId — there is no `GET /exam-sessions/{id}/seating`
 * list endpoint, so a room's plan id is learned either from generating it
 * in this session or is unknown until then (a page reload before
 * generating shows the "not generated yet" state again, which is correct:
 * nothing is lost since generation is idempotent — EC-032 — and
 * regenerating for the same room just returns the existing plan).
 */
export interface SeatingPanelProps {
  session: ExamSessionDetail;
}

export function SeatingPanel({ session }: SeatingPanelProps) {
  if (session.rooms.length === 0) {
    return <EmptyState title="No rooms allocated yet" description="Allocate rooms to this session before seating can be generated." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {session.rooms.map((room) => (
        <RoomSeatingCard key={room.id} session={session} room={room} />
      ))}
    </div>
  );
}

function RoomSeatingCard({ session, room }: { session: ExamSessionDetail; room: ExamSessionRoom }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<SeatingStrategyName>('SEQUENTIAL');
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const generateMutation = useGenerateSeating(session.id);
  const finalizeMutation = useFinalizeSeatingPlan(session.id);
  const planQuery = useSeatingPlan(planId ?? undefined);
  const seatsQuery = useRoomSeats(planId ? room.id : undefined);
  // `GET /seating-jobs/{id}` returns the same summary shape the generate
  // response did (job_id === seating_plan_id, verified against
  // `SeatingEngineService.toSummary`) — used here purely to source the
  // ANTI_CHEATING `disclaimer` field verbatim, since `GET
  // /seating-plans/{id}` itself does not include it (findByIdScoped
  // returns the plan row + assignments only).
  const jobQuery = useSeatingJob(planId ?? undefined);

  const canGenerate = session.status === 'SEATING_GENERATION';

  async function onGenerate() {
    try {
      const result = await generateMutation.mutateAsync({ room_id: room.id, strategy });
      setPlanId(result.seating_plan_id);
    } catch {
      // surfaced below via generateMutation.error
    }
  }

  async function onFinalize() {
    if (!planId) return;
    try {
      await finalizeMutation.mutateAsync(planId);
      setFinalizeOpen(false);
    } catch {
      // ConfirmationDialog has no slot for inline error content, so close
      // it on failure too — the error (and, for the hard-violations case,
      // its details) surfaces as an Alert on the card underneath instead.
      setFinalizeOpen(false);
    }
  }

  const plan = planQuery.data;
  const isReadOnly = plan ? READ_ONLY_STATUSES.has(plan.status) : false;
  const canFinalize = plan?.status === 'VALIDATED';

  const finalizeErr = finalizeMutation.error;
  const finalizeIsHardViolations = finalizeErr ? isFinalizeHardViolations409(finalizeErr) : false;
  const finalizeHardViolationDetails = finalizeIsHardViolations ? ((mapError(finalizeErr).details as unknown[] | undefined) ?? []) : [];

  return (
    <Card
      header={
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">
            {room.building} · Floor {room.floor} · Room {room.roomNumber}
          </h3>
          {plan && <StatusBadge status={plan.status} />}
        </div>
      }
      padding="dense"
    >
      <div className="flex flex-col gap-3">
        {!planId && (
          <div className="flex flex-col gap-3">
            {!canGenerate && (
              <Alert color="warning" title="Seating cannot be generated right now">
                {`Exam session is in status "${session.status}" and seating can only be generated while SEATING_GENERATION.`}
              </Alert>
            )}
            <Select
              label="Strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as SeatingStrategyName)}
              options={STRATEGY_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              disabled={!canGenerate}
            />
            <p className="text-xs text-text-muted">
              {STRATEGY_OPTIONS.find((s) => s.value === strategy)?.description}
            </p>
            {generateMutation.isError && (
              <Alert color="danger" title="Couldn't generate seating">
                {mapError(generateMutation.error).description}
              </Alert>
            )}
            <div className="flex justify-end">
              <Button onClick={onGenerate} loading={generateMutation.isPending} disabled={!canGenerate}>
                Generate Seating
              </Button>
            </div>
          </div>
        )}

        {planId && planQuery.isLoading && <SkeletonText lines={4} />}

        {planId && planQuery.isError && (
          <ErrorState
            title="Couldn't load this seating plan"
            description={mapError(planQuery.error).description}
            onRetry={() => planQuery.refetch()}
          />
        )}

        {plan && (
          <div className="flex flex-col gap-3">
            {isReadOnly && (
              <p className="text-xs text-text-muted">
                This plan is {plan.status === 'FINALIZED' ? 'finalized' : 'superseded'} — the seat map is read-only.
              </p>
            )}

            {plan.strategy === 'ANTI_CHEATING' && (generateMutation.data?.disclaimer ?? jobQuery.data?.disclaimer) && (
              <Alert color="info" title="Anti-cheating disclaimer">
                {generateMutation.data?.disclaimer ?? jobQuery.data?.disclaimer}
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-text-muted">Soft Constraint Score</dt>
                <dd className="text-text">
                  {plan.softConstraintScore != null ? `${Math.round(plan.softConstraintScore * 100)}%` : '—'}
                </dd>
              </div>
            </div>

            {plan.status === 'FAILED' && plan.violationReport && plan.violationReport.length > 0 && (
              <Alert color="danger" title="Hard constraint violations">
                <ul className="list-disc pl-4 text-xs">
                  {plan.violationReport.map((v, i) => (
                    <li key={i}>{describeViolation(v)}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {plan.status === 'VALIDATED' && plan.violationReport && plan.violationReport.length > 0 && (
              <Alert color="warning" title="Soft constraint violations">
                <ul className="list-disc pl-4 text-xs">
                  {plan.violationReport.map((v, i) => (
                    <li key={i}>{describeViolation(v)}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {seatsQuery.isLoading ? (
              <SkeletonText lines={4} />
            ) : (
              <SeatMap seats={seatsQuery.data ?? []} assignments={plan.assignments} coloring="subject" />
            )}

            {canFinalize && (
              <div className="flex justify-end">
                <Button onClick={() => setFinalizeOpen(true)} loading={finalizeMutation.isPending}>
                  Finalize
                </Button>
              </div>
            )}

            {finalizeMutation.isError && (
              <Alert color="danger" title={finalizeIsHardViolations ? 'Plan changed since it was generated' : "Couldn't finalize"}>
                <div className="flex flex-col gap-1">
                  <span>{mapError(finalizeErr).description}</span>
                  {finalizeHardViolationDetails.length > 0 && (
                    <ul className="list-disc pl-4 text-xs">
                      {finalizeHardViolationDetails.map((d, i) => (
                        <li key={i}>{describeViolation(d)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </Alert>
            )}
          </div>
        )}
      </div>

      <ConfirmationDialog
        open={finalizeOpen}
        onOpenChange={(next) => {
          setFinalizeOpen(next);
          if (!next) finalizeMutation.reset();
        }}
        title="Finalize Seating Plan"
        description="This locks in seat assignments for this room and notifies students of their seats. This cannot be undone."
        confirmLabel="Finalize"
        loading={finalizeMutation.isPending}
        onConfirm={onFinalize}
      />
    </Card>
  );
}

function describeViolation(v: unknown): string {
  if (v && typeof v === 'object' && 'message' in v && typeof (v as { message?: unknown }).message === 'string') {
    return (v as { message: string }).message;
  }
  return JSON.stringify(v);
}
