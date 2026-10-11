'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, ConfirmationDialog, EmptyState, ErrorState, Select, SkeletonText, StatusBadge } from '@/components/ui';
import { SeatMap } from '@/components/seating/SeatMap';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useCurrentSeatingPlan } from '@/lib/queries/useCurrentSeatingPlan';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import {
  useGenerateSeating,
  useRegenerateSeating,
  useFinalizeSeatingPlan,
  isFinalizeHardViolations409,
} from '@/lib/mutations/useSeatingMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, ExamSessionRoom, SeatingAssignment, SeatingStrategyName } from '@/lib/queries/types';

const STRATEGY_OPTIONS: { value: SeatingStrategyName; label: string; description: string }[] = [
  { value: 'SEQUENTIAL', label: 'Sequential', description: 'Fills seats row by row in roster order — no mixing.' },
  { value: 'ALTERNATE_SUBJECT', label: 'Alternate Subject', description: 'Takes one student from each subject in turn so neighbouring seats get different subjects (one subject only: spread by roll number and batch).' },
  { value: 'ALTERNATE_BATCH', label: 'Alternate Batch', description: 'Takes one student from each batch in turn so neighbours come from different batches (one batch only: spread by roll number).' },
  { value: 'SUBJECT_BATCH_MIX', label: 'Subject + Batch Mix', description: 'Takes one student from each subject-and-batch combination in turn, so neighbours differ in both where possible.' },
];

/** Label for a stored plan's strategy, including plans made before RANDOMIZED / ANTI_CHEATING were removed. */
function strategyLabel(strategy: string): string {
  const legacy: Record<string, string> = { RANDOMIZED: 'Randomized (retired)', ANTI_CHEATING: 'Anti-Cheating (retired)' };
  return STRATEGY_OPTIONS.find((s) => s.value === strategy)?.label ?? legacy[strategy] ?? strategy;
}

/** One line per strategy, the chosen one highlighted — so nobody has to guess what a name does. */
function StrategyHelp({ selected }: { selected: SeatingStrategyName }) {
  return (
    <ul className="flex flex-col gap-1 rounded border border-border p-2 text-xs">
      {STRATEGY_OPTIONS.map((o) => (
        <li key={o.value} className={o.value === selected ? 'text-text' : 'text-text-muted'}>
          <span className="font-medium">{o.label}:</span> {o.description}
        </li>
      ))}
    </ul>
  );
}

type ColumnChoice = 'unset' | 'keep' | 'skip';

/** Seats in every second column (1st, 3rd, 5th... are kept) — mirrors `keepAlternateColumns` in domain-logic. */
function withoutAlternateColumns<T extends { colIndex: number; isActive: boolean }>(seats: T[]): T[] {
  const columns = [...new Set(seats.filter((s) => s.isActive).map((s) => s.colIndex))].sort((a, b) => a - b);
  const kept = new Set(columns.filter((_, i) => i % 2 === 0));
  return seats.map((s) => (kept.has(s.colIndex) ? s : { ...s, isActive: false }));
}

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
  /** A request for more rooms is waiting for the admin: nothing may be generated, changed or finalized until it is decided. */
  paused?: boolean;
  /** Opens the "Request more rooms" dialog — offered where seats run short. Omit when more rooms cannot be requested. */
  onRequestMoreRooms?: () => void;
}

export function SeatingPanel({ session, readOnly = false, paused = false, onRequestMoreRooms }: SeatingPanelProps) {
  if (session.rooms.length === 0) {
    return <EmptyState title="No rooms allocated yet" description="Allocate rooms to this session before seating can be generated." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {paused && (
        <Alert color="warning" title="Seating is paused">
          A request for more rooms is waiting for admin approval. Once it is decided, the students of rooms that are not finalized are re-split and you generate
          their seating again the usual way. Withdraw the request in the Rooms step to carry on right now.
        </Alert>
      )}
      {session.rooms.map((room) => (
        <RoomSeatingCard key={room.id} session={session} room={room} readOnly={readOnly} paused={paused} onRequestMoreRooms={onRequestMoreRooms} />
      ))}
    </div>
  );
}

function RoomSeatingCard({
  session,
  room,
  readOnly,
  paused,
  onRequestMoreRooms,
}: {
  session: ExamSessionDetail;
  room: ExamSessionRoom;
  readOnly: boolean;
  paused: boolean;
  onRequestMoreRooms?: () => void;
}) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<SeatingStrategyName>('SEQUENTIAL');
  const [changingStrategy, setChangingStrategy] = useState(false);
  const [newStrategy, setNewStrategy] = useState<SeatingStrategyName>('SEQUENTIAL');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  // Asked before generating: leave every second column empty? Must be answered — no silent default.
  // The answer given when rooms were requested is pre-selected (still changeable per room); never answered = ask.
  const plannedChoice: ColumnChoice = session.emptyColumnsPlanned === true ? 'skip' : session.emptyColumnsPlanned === false ? 'keep' : 'unset';
  const [columnChoice, setColumnChoice] = useState<ColumnChoice>(plannedChoice);
  const [newColumnChoice, setNewColumnChoice] = useState<ColumnChoice>(plannedChoice);

  const generateMutation = useGenerateSeating(session.id);
  const regenerateMutation = useRegenerateSeating(session.id);
  const finalizeMutation = useFinalizeSeatingPlan(session.id);
  const planQuery = useSeatingPlan(planId ?? undefined);
  const seatsQuery = useRoomSeats(room.id); // always loaded: the layout is shown before AND after generating
  // Best-effort id->label maps to translate the raw UUIDs baked into
  // domain-logic's violation `message` strings (that package is pure and
  // has no DB access, so it can only ever know ids) into names a faculty
  // can actually recognize. Same "fetch up to 200, look up client-side"
  // pattern already used elsewhere in this codebase (e.g. RosterPanel).
  const subjectsQuery = useSubjects({ all: true });
  const batchesQuery = useBatches({ all: true });

  const canGenerate = session.status === 'SEATING_GENERATION' && !readOnly && !paused;

  // A plan generated earlier (before a page reload, or by someone else) is found again from the server, so
  // this card never offers a fresh "Generate" for a room that already has seating — which would only hand
  // back the old plan and ignore the strategy / empty-column choice just made.
  const currentPlanQuery = useCurrentSeatingPlan(session.id, room.id);
  const currentPlanId = currentPlanQuery.data?.seating_plan_id ?? null;
  useEffect(() => {
    if (!planId && currentPlanId) setPlanId(currentPlanId);
  }, [planId, currentPlanId]);
  // A re-split after "more rooms" supersedes this room's old seating: follow the server to the current plan (none = "not generated yet").
  const shownPlanStatus = planQuery.data?.status;
  useEffect(() => {
    if (shownPlanStatus === 'SUPERSEDED' && currentPlanQuery.isSuccess && currentPlanId !== planId) setPlanId(currentPlanId);
  }, [shownPlanStatus, currentPlanQuery.isSuccess, currentPlanId, planId]);

  async function onGenerate() {
    try {
      const result = await generateMutation.mutateAsync({ room_id: room.id, strategy, skip_alternate_columns: columnChoice === 'skip' });
      setPlanId(result.seating_plan_id);
    } catch {
      // surfaced below via generateMutation.error
    }
  }

  async function onRegenerate() {
    try {
      const result = await regenerateMutation.mutateAsync({
        room_id: room.id,
        strategy: newStrategy,
        skip_alternate_columns: newColumnChoice === 'skip',
      });
      setPlanId(result.seating_plan_id);
      setChangingStrategy(false);
      setNewColumnChoice(plannedChoice);
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
  const canFinalize = plan?.status === 'VALIDATED' && !readOnly && !paused;
  const canChangeStrategy = plan ? CAN_CHANGE_STRATEGY_STATUSES.has(plan.status) && !readOnly && !paused : false;

  // The "one subject — spread by roll number" notice is stored as a violation-report entry; show it as
  // information, not as a violation.
  const spreadNotice = (plan?.violationReport ?? []).some(
    (v) => (v as { type?: string } | null)?.type === 'SINGLE_SUBJECT_FALLBACK',
  );
  const reportedViolations = (plan?.violationReport ?? []).filter(
    (v) => (v as { type?: string } | null)?.type !== 'SINGLE_SUBJECT_FALLBACK',
  );

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
          <div>
            <h3 className="text-sm font-semibold text-text">Room {room.roomNumber}</h3>
            <p className="text-xs text-text-muted">
              Building {room.building} · Floor {room.floor} · {room.allocatedCapacity} students allocated
            </p>
          </div>
          {plan && <StatusBadge status={plan.status} />}
        </div>
      }
      padding="dense"
    >
      <div className="flex flex-col gap-3">
        {!planId && currentPlanQuery.isLoading && <SkeletonText lines={3} />}
        {!planId && !currentPlanQuery.isLoading && readOnly && (
          <EmptyState title="Seating not generated yet" description="This is a read-only view — seating generation is driven by the owning faculty." />
        )}
        {!planId && !currentPlanQuery.isLoading && !readOnly && (
          <div className="flex flex-col gap-3">
            {!canGenerate && !paused && (
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
            <StrategyHelp selected={strategy} />
            <ColumnGapQuestion
              name={`gap-${room.id}`}
              value={columnChoice}
              onChange={setColumnChoice}
              seats={seatsQuery.data ?? []}
              students={room.allocatedCapacity}
              disabled={!canGenerate}
              onRequestMoreRooms={canGenerate ? onRequestMoreRooms : undefined}
            />
            <RoomLayoutPreview
              roomLabel={`Room ${room.roomNumber}`}
              seats={seatsQuery.data ?? []}
              loading={seatsQuery.isLoading}
              skipColumns={columnChoice === 'skip'}
            />
            {generateMutation.isError && (
              <Alert color="danger" title="Couldn't generate seating">
                {mapError(generateMutation.error).description}
              </Alert>
            )}
            <div className="flex justify-end">
              <Button onClick={onGenerate} loading={generateMutation.isPending} disabled={!canGenerate || columnChoice === 'unset'}>
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

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-text-muted">Strategy</dt>
                <dd className="text-text">{strategyLabel(plan.strategy)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Soft Constraint Score</dt>
                <dd className="text-text">
                  {plan.softConstraintScore != null ? `${Math.round(plan.softConstraintScore * 100)}%` : '—'}
                </dd>
              </div>
            </div>
            <ScoreExplanation score={plan.softConstraintScore} />

            {spreadNotice && (
              <Alert color="info" title="One subject in this room">
                Everyone here sits the same subject, so seats were spread by roll number and batch instead — consecutive roll numbers are kept apart and rows are staggered.
              </Alert>
            )}

            {plan.status === 'FAILED' && onRequestMoreRooms && !paused && (
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={onRequestMoreRooms}>
                  Request more rooms
                </Button>
                <span className="text-xs text-text-muted">if this room cannot seat everyone assigned to it</span>
              </div>
            )}

            {plan.status === 'FAILED' && reportedViolations.length > 0 && (
              <Alert color="danger" title="Hard constraint violations">
                <ul className="list-disc pl-4 text-xs">
                  {reportedViolations.map((v, i) => (
                    <li key={i}>{describeViolation(v)}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {plan.status === 'VALIDATED' && reportedViolations.length > 0 && (
              <Alert color="warning" title="Soft constraint violations">
                <ul className="list-disc pl-4 text-xs">
                  {reportedViolations.map((v, i) => (
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
                    <Button variant="secondary" size="sm" onClick={() => { setNewStrategy(STRATEGY_OPTIONS.some((o) => o.value === plan.strategy) ? (plan.strategy as SeatingStrategyName) : 'SEQUENTIAL'); setNewColumnChoice(plannedChoice); setChangingStrategy(true); }}>
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
                    <StrategyHelp selected={newStrategy} />
                    <ColumnGapQuestion
                      name={`regap-${room.id}`}
                      value={newColumnChoice}
                      onChange={setNewColumnChoice}
                      seats={seatsQuery.data ?? []}
                      students={room.allocatedCapacity}
                      onRequestMoreRooms={onRequestMoreRooms}
                    />
                    {regenerateMutation.isError && (
                      <Alert color="danger" title="Couldn't regenerate seating">
                        {mapError(regenerateMutation.error).description}
                      </Alert>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setChangingStrategy(false)} disabled={regenerateMutation.isPending}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={onRegenerate} loading={regenerateMutation.isPending} disabled={newColumnChoice === 'unset'}>
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
              <div className="flex flex-col gap-1">
                <p className="text-xs text-text-muted">Room {room.roomNumber} · Building {room.building} — front of the room at the top</p>
                <SeatMap seats={seatsQuery.data ?? []} assignments={plan.assignments} coloring="subject" />
              </div>
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

/** What the Soft Constraint Score means, in plain words — and what this plan's value says. */
function ScoreExplanation({ score }: { score: number | null }) {
  const percent = score == null ? null : Math.round(score * 100);
  const verdict =
    percent == null
      ? null
      : percent >= 100
        ? 'No two neighbours share a subject, batch or quiz — the best possible result.'
        : percent >= 70
          ? 'Most neighbours differ; a few still share a subject, batch or quiz (listed below).'
          : 'Many neighbours share a subject, batch or quiz. Try another strategy or room mix.';
  return (
    <p className="text-xs text-text-muted" data-testid="score-explanation">
      <span className="font-medium text-text">What this score means:</span> how well students sitting side by side, or one behind the
      other, differ in subject, batch and quiz (for a one-subject room: batch and roll number). 100% = nobody has a matching neighbour; lower =
      more matching neighbours. It is advice only — a low score never blocks finalizing.
      {verdict && <span className="mt-1 block text-text">{verdict}</span>}
    </p>
  );
}

/** The question asked before every generation: leave an empty column between students? */
function ColumnGapQuestion({
  name,
  value,
  onChange,
  seats,
  students,
  disabled,
  onRequestMoreRooms,
}: {
  name: string;
  value: ColumnChoice;
  onChange: (next: ColumnChoice) => void;
  seats: { colIndex: number; isActive: boolean }[];
  students: number;
  disabled?: boolean;
  /** Offered when empty columns would not leave enough seats — the way out is more rooms. */
  onRequestMoreRooms?: () => void;
}) {
  const usable = withoutAlternateColumns(seats).filter((s) => s.isActive).length;
  const total = seats.filter((s) => s.isActive).length;
  const fits = usable >= students;
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium text-text">Leave an empty seat column between students?</legend>
      <p className="text-xs text-text-muted">
        Skipping every second column means nobody has a side neighbour, which is the strongest seating-only way to reduce copying — but it uses fewer seats.
        This room has {total} seats for {students} students; with empty columns {usable} seats stay usable.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} checked={value === 'keep'} onChange={() => onChange('keep')} />
        No — use every column
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} checked={value === 'skip'} onChange={() => onChange('skip')} disabled={!fits} />
        Yes — leave every second column empty
        {!fits && <span className="text-xs text-text-muted">(not enough seats: {usable} usable for {students} students)</span>}
      </label>
      {!fits && onRequestMoreRooms && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRequestMoreRooms}>
            Request more rooms
          </Button>
          <span className="text-xs text-text-muted">to make room for the empty-column layout</span>
        </div>
      )}
      {value === 'unset' && <p className="text-xs text-warning">Choose one to continue.</p>}
    </fieldset>
  );
}

/** Empty-room layout shown before seating is generated: the seats that will be used, with the room's name. */
function RoomLayoutPreview({
  roomLabel,
  seats,
  loading,
  skipColumns,
}: {
  roomLabel: string;
  seats: { id: string; rowIndex: number; colIndex: number; seatLabel: string; isActive: boolean; isAccessible: boolean }[];
  loading: boolean;
  skipColumns: boolean;
}) {
  if (loading) return <SkeletonText lines={3} />;
  const shown = skipColumns ? withoutAlternateColumns(seats) : seats;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-text">
        {roomLabel} layout{skipColumns ? ' — blank columns stay empty' : ''}
      </p>
      <SeatMap seats={shown} assignments={[]} coloring="subject" />
    </div>
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
