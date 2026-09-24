'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, ConfirmationDialog, EmptyState, ErrorState, Select, SkeletonText, StatusBadge } from '@/components/ui';
import { SeatMap } from '@/components/seating/SeatMap';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { useSeatingJob } from '@/lib/queries/useSeatingJob';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import {
  useGenerateSeating,
  useRegenerateSeating,
  useFinalizeSeatingPlan,
  isFinalizeHardViolations409,
} from '@/lib/mutations/useSeatingMutations';
import { apiFetch } from '@/lib/api-client';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, ExamSessionRoom, SeatingAssignment, SeatingGenerationSummary, SeatingStrategyName } from '@/lib/queries/types';

const STRATEGY_OPTIONS: { value: SeatingStrategyName; label: string; description: string }[] = [
  { value: 'SEQUENTIAL', label: 'Sequential', description: 'Fills seats row by row, in roster order.' },
  { value: 'RANDOMIZED', label: 'Randomized', description: 'Assigns seats in a random, reproducible order.' },
  { value: 'ALTERNATE_SUBJECT', label: 'Alternate Subject', description: 'Alternates neighboring seats between different subjects where possible.' },
  { value: 'ALTERNATE_BATCH', label: 'Alternate Batch', description: 'Alternates neighboring seats between different student batches where possible.' },
  { value: 'SUBJECT_BATCH_MIX', label: 'Subject + Batch Mix', description: 'Balances both subject and batch diversity between neighbors.' },
  { value: 'ANTI_CHEATING', label: 'Anti-Cheating', description: 'Maximizes neighbor diversity to reduce opportunistic copying risk.' },
];

const READ_ONLY_STATUSES = new Set(['FINALIZED', 'SUPERSEDED']);
// A room's plan can still be changed (regenerated with a different
// strategy) right up until it's FINALIZED — VALIDATED and FAILED both
// qualify (FAILED just means the last attempt had hard violations; trying
// a different strategy is exactly the recovery path for that).
const CAN_CHANGE_STRATEGY_STATUSES = new Set(['VALIDATED', 'FAILED']);

/**
 * One seating card per room allocated to this session. Each room's plan
 * (if any) is looked up independently via `useSeatingPlan` keyed by a
 * locally-tracked planId — there is no `GET /exam-sessions/{id}/seating`
 * list endpoint, so a room's plan id is learned either from generating it
 * in this session or is unknown until then (a page reload before
 * generating shows the "not generated yet" state again, which is correct:
 * nothing is lost since generation is idempotent — EC-032 — and
 * regenerating for the same room just returns the existing plan; use
 * "Change Strategy" below to force a genuinely fresh plan instead).
 */
export interface SeatingPanelProps {
  session: ExamSessionDetail;
  /** Faculty-lifecycle-ownership change: ADMIN is now read-only for scheduling data — pass `true` to hide Generate/Finalize actions, keeping only the seat map itself. */
  readOnly?: boolean;
}

export function SeatingPanel({ session, readOnly = false }: SeatingPanelProps) {
  if (session.rooms.length === 0) {
    return <EmptyState title="No rooms allocated yet" description="Allocate rooms to this session before seating can be generated." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {session.rooms.map((room) => (
        <RoomSeatingCard key={room.id} session={session} room={room} readOnly={readOnly} />
      ))}
    </div>
  );
}

function RoomSeatingCard({
  session,
  room,
  readOnly,
}: {
  session: ExamSessionDetail;
  room: ExamSessionRoom;
  readOnly: boolean;
}) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<SeatingStrategyName>('SEQUENTIAL');
  const [changingStrategy, setChangingStrategy] = useState(false);
  const [newStrategy, setNewStrategy] = useState<SeatingStrategyName>('SEQUENTIAL');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const generateMutation = useGenerateSeating(session.id);
  const regenerateMutation = useRegenerateSeating(session.id);
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
  // Best-effort id->label maps to translate the raw UUIDs baked into
  // domain-logic's violation `message` strings (that package is pure and
  // has no DB access, so it can only ever know ids) into names a faculty
  // can actually recognize. Same "fetch up to 200, look up client-side"
  // pattern already used elsewhere in this codebase (e.g. RosterPanel).
  const subjectsQuery = useSubjects({ limit: 200 });
  const batchesQuery = useBatches({ limit: 200 });

  const canGenerate = session.status === 'SEATING_GENERATION' && !readOnly;

  // Recovery for the case this screenshot showed: the plan was already
  // generated earlier (that's WHY the session could advance past
  // SEATING_GENERATION), but its id only ever lived in this component's
  // local state — a page reload loses it, and the session status now
  // correctly blocks the "Generate Seating" button, leaving no way back
  // to the plan that already exists. Safe to auto-probe here specifically
  // BECAUSE `canGenerate` is false: `generate` checks EC-032 idempotency
  // (an existing plan) before it ever checks session status, so this call
  // can only ever return an already-existing plan or 409 — it can never
  // create a new one while `!canGenerate` (the status check happens after
  // the idempotency check and would reject before any create). Uses a
  // bare apiFetch, not `useGenerateSeating`, so a genuine "nothing exists
  // yet" 409 here doesn't light up the explicit Generate button's own
  // error banner.
  useEffect(() => {
    if (planId || canGenerate) return;
    let cancelled = false;
    apiFetch<SeatingGenerationSummary>(`/exam-sessions/${session.id}/seating/generate`, {
      method: 'POST',
      body: { room_id: room.id, strategy: 'SEQUENTIAL' },
    })
      .then((result) => {
        if (!cancelled) setPlanId(result.seating_plan_id);
      })
      .catch(() => {
        // No plan exists for this room and generation is no longer
        // allowed either — genuinely nothing to recover, fall through to
        // the normal "cannot be generated right now" messaging below.
      });
    return () => {
      cancelled = true;
    };
  }, [planId, canGenerate, session.id, room.id]);

  async function onGenerate() {
    try {
      const result = await generateMutation.mutateAsync({ room_id: room.id, strategy });
      setPlanId(result.seating_plan_id);
    } catch {
      // surfaced below via generateMutation.error
    }
  }

  async function onRegenerate() {
    try {
      const result = await regenerateMutation.mutateAsync({ room_id: room.id, strategy: newStrategy });
      setPlanId(result.seating_plan_id);
      setChangingStrategy(false);
    } catch {
      // surfaced below via regenerateMutation.error
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
  const canFinalize = plan?.status === 'VALIDATED' && !readOnly;
  const canChangeStrategy = plan ? CAN_CHANGE_STRATEGY_STATUSES.has(plan.status) && !readOnly : false;

  const finalizeErr = finalizeMutation.error;
  const finalizeIsHardViolations = finalizeErr ? isFinalizeHardViolations409(finalizeErr) : false;
  const finalizeHardViolationDetails = finalizeIsHardViolations ? ((mapError(finalizeErr).details as unknown[] | undefined) ?? []) : [];

  const idLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const seat of seatsQuery.data ?? []) map.set(seat.id, `Seat ${seat.seatLabel}`);
    for (const a of plan?.assignments ?? []) {
      map.set(a.studentId, a.student.name);
      map.set(a.quizId, a.quiz.title);
    }
    for (const s of subjectsQuery.data?.items ?? []) map.set(s.id, `${s.code} — ${s.name}`);
    for (const b of batchesQuery.data?.items ?? []) map.set(b.id, `${b.year} · ${b.section}-${b.subsection}`);
    return map;
  }, [seatsQuery.data, plan?.assignments, subjectsQuery.data, batchesQuery.data]);

  function describeViolation(v: unknown): string {
    const raw =
      v && typeof v === 'object' && 'message' in v && typeof (v as { message?: unknown }).message === 'string'
        ? (v as { message: string }).message
        : JSON.stringify(v);
    let text = raw;
    for (const [id, label] of idLabels) {
      if (id && text.includes(id)) text = text.split(id).join(label);
    }
    return text;
  }

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
        {!planId && readOnly && (
          <EmptyState title="Seating not generated yet" description="This is a read-only view — seating generation is driven by the owning faculty." />
        )}
        {!planId && !readOnly && (
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
                <dt className="text-text-muted">Strategy</dt>
                <dd className="text-text">{STRATEGY_OPTIONS.find((s) => s.value === plan.strategy)?.label ?? plan.strategy}</dd>
              </div>
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

            {canChangeStrategy && (
              <div className="flex flex-col gap-2 rounded border border-border p-3">
                {!changingStrategy ? (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-text-muted">Not happy with this arrangement? You can try a different strategy before finalizing.</p>
                    <Button variant="secondary" size="sm" onClick={() => { setNewStrategy(plan.strategy); setChangingStrategy(true); }}>
                      Change Strategy
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Select
                      label="New strategy"
                      value={newStrategy}
                      onChange={(e) => setNewStrategy(e.target.value as SeatingStrategyName)}
                      options={STRATEGY_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                    />
                    <p className="text-xs text-text-muted">
                      {STRATEGY_OPTIONS.find((s) => s.value === newStrategy)?.description}
                    </p>
                    {regenerateMutation.isError && (
                      <Alert color="danger" title="Couldn't regenerate seating">
                        {mapError(regenerateMutation.error).description}
                      </Alert>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setChangingStrategy(false)} disabled={regenerateMutation.isPending}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={onRegenerate} loading={regenerateMutation.isPending}>
                        Regenerate
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text">Seating</span>
              <div className="flex gap-1">
                <Button variant={view === 'grid' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('grid')}>
                  Grid
                </Button>
                <Button variant={view === 'list' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('list')}>
                  List
                </Button>
              </div>
            </div>

            {seatsQuery.isLoading ? (
              <SkeletonText lines={4} />
            ) : view === 'grid' ? (
              <SeatMap seats={seatsQuery.data ?? []} assignments={plan.assignments} coloring="subject" />
            ) : (
              <SeatingListView assignments={plan.assignments} />
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

/** Plain seat->student->quiz table — a faster overview than clicking through the grid one seat at a time to see who sits where. */
function SeatingListView({ assignments }: { assignments: SeatingAssignment[] }) {
  if (assignments.length === 0) {
    return <p className="text-sm text-text-muted">No seats assigned yet.</p>;
  }
  const sorted = [...assignments].sort((a, b) => a.seat.seatLabel.localeCompare(b.seat.seatLabel, undefined, { numeric: true }));

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs text-text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Seat</th>
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Quiz</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{a.seat.seatLabel}</td>
              <td className="px-3 py-2 text-text">{a.student.rollNumber} — {a.student.name}</td>
              <td className="px-3 py-2 text-text-muted">{a.quiz.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
