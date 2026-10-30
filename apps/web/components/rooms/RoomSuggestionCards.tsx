'use client';

import { Badge } from '@/components/ui';
import type { AvailableRoomOption, RoomSuggestionAlternative, RoomSuggestionResult, RoomSuggestionStrategy, SuggestedRoom } from '@/lib/queries/types';
import { buildCustomPlan, differsFromPlan, type CustomRoomPlan } from '@/lib/room-plan';
import { SharedRoomNote } from './SharedRoomNote';

/** Which way of placing the rooms the person picked when two differ: stay together, or the fewest rooms overall. */
export type LocationChoice = 'together' | 'alternative';

/** The room-planning answer to "leave every second column empty?" — must be answered before rooms are suggested. */
export type EmptyColumnsAnswer = 'unset' | 'no' | 'yes';

export function EmptyColumnsQuestion({
  name,
  value,
  onChange,
}: {
  name: string;
  value: EmptyColumnsAnswer;
  onChange: (next: EmptyColumnsAnswer) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
      <legend className="px-1 text-sm font-medium text-text">Leave every second seat column empty in the exam?</legend>
      <p className="text-xs text-text-muted">
        With empty columns nobody has a side neighbour, which is the strongest seating-only way to reduce copying — but only about half of each
        room&apos;s seats can be used, so more rooms are needed. Rooms below are sized for your answer, and it is pre-selected when seating is set up.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} checked={value === 'no'} onChange={() => onChange('no')} />
        No — use every column
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} checked={value === 'yes'} onChange={() => onChange('yes')} />
        Yes — leave every second column empty
      </label>
      {value === 'unset' && <p className="text-xs text-warning">Choose one to see room suggestions.</p>}
    </fieldset>
  );
}

/** Label for a saved strategy, including ones from before Sequential was retired. */
export function roomStrategyLabel(strategy: string): string {
  switch (strategy) {
    case 'FEWEST_ROOMS':
      return 'Fewest Classes';
    case 'BALANCED_SPREAD':
      return 'Balanced Spread';
    case 'SEQUENTIAL':
      return 'Sequential (retired)';
    default:
      return strategy;
  }
}

/** The strategy cards, plus — only when fewer rooms are possible by leaving the building/floor — a clear either/or the person must answer. */
export function RoomSuggestionCards({
  strategies,
  totalStudents,
  selectedStrategy,
  locationChoice,
  roomIds,
  allRooms,
  onPickStrategy,
  onChooseLocation,
}: {
  strategies: RoomSuggestionResult[];
  totalStudents: number;
  selectedStrategy: RoomSuggestionStrategy | null;
  locationChoice: LocationChoice | null;
  /** The rooms actually in the request right now — when the person edits them by hand, the selected card follows. */
  roomIds: string[];
  allRooms: AvailableRoomOption[];
  onPickStrategy: (result: RoomSuggestionResult) => void;
  onChooseLocation: (result: RoomSuggestionResult, choice: LocationChoice) => void;
}) {
  const selected = strategies.find((s) => s.strategy === selectedStrategy);
  // The rooms of the plan the person picked; if the request no longer matches them (a room added/removed by hand), show the real split instead.
  const planRoomIds = !selected ? [] : locationChoice === 'alternative' && selected.alternative ? selected.alternative.rooms.map((r) => r.roomId) : locationChoice === 'together' || !selected.alternative ? selected.rooms.map((r) => r.roomId) : [];
  const custom: CustomRoomPlan | null =
    selected && differsFromPlan(planRoomIds, roomIds) ? buildCustomPlan(selected.strategy, roomIds, allRooms, totalStudents) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {strategies.map((s) => (
          <StrategyCard
            key={s.strategy}
            result={s}
            totalStudents={totalStudents}
            selected={selectedStrategy === s.strategy}
            custom={selectedStrategy === s.strategy ? custom : null}
            onSelect={() => onPickStrategy(s)}
          />
        ))}
      </div>
      {selected?.alternative && (
        <fieldset className="flex flex-col gap-2 rounded border border-warning-border bg-warning-bg p-3" data-testid="location-choice">
          <legend className="px-1 text-sm font-medium text-text">Fewer rooms are possible — which do you prefer?</legend>
          <ChoiceOption
            name={`location-${selected.strategy}`}
            checked={locationChoice === 'together'}
            onSelect={() => onChooseLocation(selected, 'together')}
            title={`Stay together — ${selected.roomCount} room${selected.roomCount === 1 ? '' : 's'}`}
            detail={selected.location}
            rooms={selected.rooms}
          />
          <ChoiceOption
            name={`location-${selected.strategy}`}
            checked={locationChoice === 'alternative'}
            onSelect={() => onChooseLocation(selected, 'alternative')}
            title={`${selected.alternative.label} — ${selected.alternative.roomCount} room${selected.alternative.roomCount === 1 ? '' : 's'}`}
            detail={`${selected.alternative.location}${selected.alternative.spansBuildings ? ' (different buildings)' : ''}`}
            rooms={selected.alternative.rooms}
          />
          {locationChoice === null && <p className="text-xs text-warning">Choose one to continue.</p>}
        </fieldset>
      )}
    </div>
  );
}

function ChoiceOption({
  name,
  checked,
  onSelect,
  title,
  detail,
  rooms,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  rooms: SuggestedRoom[];
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded border border-border bg-surface p-2 text-sm">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-1" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-text">{title}</span>
        <span className="text-xs text-text-muted">{detail}</span>
        <span className="text-xs text-text-muted">
          {rooms.slice(0, 5).map((r) => `${r.building}-${r.roomNumber} (${r.allocated}/${r.capacity})${r.sharedWith?.length ? ' · shared' : ''}`).join(', ')}
          {rooms.length > 5 ? ` + ${rooms.length - 5} more` : ''}
        </span>
      </span>
    </label>
  );
}

function StrategyCard({
  result,
  totalStudents,
  selected,
  custom,
  onSelect,
}: {
  result: RoomSuggestionResult;
  totalStudents: number;
  selected: boolean;
  /** Set on the selected card when the rooms were edited by hand: shown instead of the original suggestion. */
  custom: CustomRoomPlan | null;
  onSelect: () => void;
}) {
  const shown = custom ?? result;
  const covers = shown.totalCapacity >= totalStudents;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-2 rounded border p-3 text-left transition-colors ${
        selected ? 'border-primary-600 bg-primary-50' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">{result.label}</span>
        {selected && (custom ? <Badge color="warning">Edited by you</Badge> : <Badge color="success">Selected</Badge>)}
      </div>
      <p className="text-xs text-text-muted">{result.description}</p>
      {custom && (
        <p className="text-xs text-warning" data-testid="custom-plan-note">
          Showing the rooms you picked below, split the same way. Click this card again to go back to the suggestion.
        </p>
      )}
      {shown.location && <p className="text-xs font-medium text-text">{shown.location}</p>}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-text-muted">
          <span>
            {shown.roomCount} class{shown.roomCount === 1 ? '' : 'es'}
          </span>
          <span>{shown.utilizationPercent}% filled</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={`h-full rounded-full ${covers ? 'bg-primary-600' : 'bg-danger-600'}`}
            style={{ width: `${Math.min(100, shown.utilizationPercent)}%` }}
          />
        </div>
        {!covers && (
          <p className="text-xs text-danger-text">
            Falls short — only {shown.totalCapacity} of {totalStudents} seats.
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-0.5 text-xs text-text-muted">
        {shown.rooms.length === 0 && <li>No rooms selected.</li>}
        {shown.rooms.slice(0, 4).map((r) => (
          <li key={r.roomId}>
            {r.building} {r.roomNumber} — {r.allocated}/{r.capacity}
            <SharedRoomNote sharedWith={r.sharedWith} left={r.capacity} />
          </li>
        ))}
        {shown.rooms.length > 4 && (
          <li>
            + {shown.rooms.length - 4} more
            {shown.rooms.slice(4).some((r) => r.sharedWith?.length) && ' (some shared with other quizzes)'}
          </li>
        )}
      </ul>
    </button>
  );
}

/**
 * Whether the backup room's seats are locked too once the quiz is approved. Shown with what each choice means;
 * the faculty member picks, and the admin can change it while approving.
 */
export function BackupLockChoice({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded border border-border p-3" disabled={disabled} data-testid="backup-lock-choice">
      <legend className="px-1 text-sm font-medium text-text">Keep the backup room free for this quiz?</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name={name} checked={value} onChange={() => onChange(true)} className="mt-1" />
        <span>
          <span className="font-medium text-text">Lock it too</span>
          <span className="block text-xs text-text-muted">
            The backup stays free for you: no other quiz can use those seats until your rooms are allocated, then it is released. If a main room fails, the backup
            is guaranteed. The cost: those seats are unavailable to others meanwhile.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name={name} checked={!value} onChange={() => onChange(false)} className="mt-1" />
        <span>
          <span className="font-medium text-text">Don&apos;t lock it</span>
          <span className="block text-xs text-text-muted">
            Other quizzes may book the backup first. If a main room fails and the backup is already taken, it is not guaranteed — you would have to request another room.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

export type { RoomSuggestionAlternative };
