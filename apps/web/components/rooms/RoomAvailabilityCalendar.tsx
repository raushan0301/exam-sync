'use client';

import { cn, SkeletonText, ErrorState, EmptyState } from '@/components/ui';
import { useRoomsAvailability } from '@/lib/queries/useRoomsAvailability';
import { mapError } from '@/lib/error-mapping';
import { formatTimeRange } from '@/lib/format-time';
import type { RoomBookedRange } from '@/lib/queries/types';

export interface RoomAvailabilityCalendarProps {
  /** YYYY-MM-DD — the day to show booked ranges for. */
  date: string;
  /** Highlights this exact [startTime, endTime) window (e.g. the session's own slot) so a faculty can see at a glance which rooms are already busy during it. */
  highlightRange?: { startTime: string; endTime: string };
  /** Narrow to one room; omit to show every room. */
  roomId?: string;
  /** Narrow to this specific set of rooms (e.g. only the ones actually requested) — takes precedence over `roomId` when both are given. Omit both to show every room. */
  roomIds?: string[];
}

const DAY_START_MINUTES = 7 * 60; // 07:00
const DAY_END_MINUTES = 20 * 60; // 20:00
const TOTAL_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function pct(minutes: number): number {
  const clamped = Math.min(Math.max(minutes, DAY_START_MINUTES), DAY_END_MINUTES);
  return ((clamped - DAY_START_MINUTES) / TOTAL_MINUTES) * 100;
}

const HOUR_MARKS = Array.from(
  { length: Math.floor(TOTAL_MINUTES / 60) + 1 },
  (_, i) => DAY_START_MINUTES + i * 60,
);

/**
 * Visual room-availability calendar (faculty-lifecycle-ownership change):
 * one horizontal timeline row per room, booked ranges rendered as blocks
 * — sourced from real data via `GET /rooms/availability` (actual
 * `exam_session_rooms` allocations for the day, plus admin-declared
 * `room_availability` maintenance blocks), never a guess or an
 * after-the-fact rejection. Lets a faculty see which rooms are already
 * booked at which times BEFORE picking a room/time for allocation.
 */
export function RoomAvailabilityCalendar({ date, highlightRange, roomId, roomIds }: RoomAvailabilityCalendarProps) {
  const query = useRoomsAvailability({ date, roomId: roomIds ? undefined : roomId });

  if (query.isLoading) {
    return <SkeletonText lines={4} />;
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load room availability"
        description={mapError(query.error).description}
        onRetry={() => query.refetch()}
      />
    );
  }

  const allEntries = query.data ?? [];
  const entries = roomIds ? allEntries.filter((e) => roomIds.includes(e.room.id)) : allEntries;
  if (entries.length === 0) {
    return <EmptyState title="No rooms found" description="There are no rooms to show availability for." />;
  }

  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <div className="flex min-w-[560px] flex-col gap-1">
        {/* Hour ruler */}
        <div className="ml-32 flex text-[10px] text-text-subtle">
          {HOUR_MARKS.map((m) => (
            <span key={m} style={{ width: `${100 / (HOUR_MARKS.length - 1)}%` }} className="shrink-0">
              {String(Math.floor(m / 60)).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {entries.map(({ room, bookedRanges }) => (
          <div key={room.id} className="flex items-center gap-2">
            <div className="w-32 shrink-0 truncate text-xs text-text" title={`${room.building} · ${room.roomNumber}`}>
              {room.building} · {room.roomNumber}
            </div>
            <div className="relative h-6 flex-1 rounded bg-neutral-100">
              {highlightRange && (
                <div
                  className="absolute inset-y-0 rounded bg-info-bg ring-2 ring-inset ring-info-text"
                  style={{
                    left: `${pct(toMinutes(highlightRange.startTime))}%`,
                    width: `${Math.max(pct(toMinutes(highlightRange.endTime)) - pct(toMinutes(highlightRange.startTime)), 1.5)}%`,
                  }}
                  title={`This session's requested window: ${formatTimeRange(highlightRange.startTime, highlightRange.endTime)}`}
                />
              )}
              {bookedRanges.map((range: RoomBookedRange, i: number) => {
                const left = pct(toMinutes(range.start_time));
                const width = Math.max(pct(toMinutes(range.end_time)) - left, 1);
                const when = formatTimeRange(range.start_time, range.end_time);
                const label =
                  range.source === 'EXAM_SESSION'
                    ? `Booked: ${range.exam_session_name ?? 'Exam session'} (${when})`
                    : range.source === 'SEAT_HOLD'
                      ? `Seats held: ${range.seats_held ?? 0} seat${range.seats_held === 1 ? '' : 's'} by ${(range.quiz_titles ?? []).join(', ') || 'an approved quiz'} (${when}) — the room is shared, not full`
                      : `Unavailable: ${range.reason ?? 'Maintenance block'} (${when})`;
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute inset-y-0.5 rounded-sm',
                      range.source === 'EXAM_SESSION' && 'bg-danger-bg',
                      range.source === 'AVAILABILITY_BLOCK' && 'bg-warning-bg',
                      range.source === 'SEAT_HOLD' && 'border border-dashed border-primary-500 bg-primary-50',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={label}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-danger-bg" aria-hidden="true" /> Booked (exam session)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning-bg" aria-hidden="true" /> Unavailable (maintenance block)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-primary-500 bg-primary-50" aria-hidden="true" /> Seats held by an approved quiz (room still shared)
        </span>
        {highlightRange && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-info-bg ring-2 ring-inset ring-info-text" aria-hidden="true" /> This session&apos;s window (
            {formatTimeRange(highlightRange.startTime, highlightRange.endTime)})
          </span>
        )}
      </div>
    </div>
  );
}
