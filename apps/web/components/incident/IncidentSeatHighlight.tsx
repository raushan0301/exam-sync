'use client';

import { SkeletonText, ErrorState } from '@/components/ui';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { mapError } from '@/lib/error-mapping';

export interface IncidentSeatHighlightProps {
  roomId: string;
  seatId: string;
  studentLabel?: string | null;
}

/**
 * Read-only room seat grid with ONE seat highlighted — the seat/student an
 * incident report was filed against. Deliberately does not go through
 * `SeatMap`/the seating-plan endpoints: `GET /rooms/{id}/seats` is open to
 * any authenticated role, but recovering a room's seating-plan id (the
 * generate/regenerate endpoints `SeatMap`'s assignment-coloring modes need)
 * is `@Roles(ROLE.FACULTY)`-only, so an ADMIN reviewer can't resolve one.
 * The incident row already carries `studentLabel`/`roomLabel` directly, so
 * a full assignment-colored grid isn't needed here — just "where they sat."
 */
export function IncidentSeatHighlight({ roomId, seatId, studentLabel }: IncidentSeatHighlightProps) {
  const seatsQuery = useRoomSeats(roomId);

  if (seatsQuery.isLoading) return <SkeletonText lines={3} />;
  if (seatsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load the room's seat map"
        description={mapError(seatsQuery.error).description}
        onRetry={() => seatsQuery.refetch()}
      />
    );
  }

  const seats = seatsQuery.data ?? [];
  if (seats.length === 0) return null;

  const seatsByRow = new Map<number, typeof seats>();
  for (const seat of seats) {
    const row = seatsByRow.get(seat.rowIndex) ?? [];
    row.push(seat);
    seatsByRow.set(seat.rowIndex, row);
  }
  const rowIndices = [...seatsByRow.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 overflow-x-auto">
        {rowIndices.map((rowIdx) => (
          <div key={rowIdx} className="flex gap-1">
            {(seatsByRow.get(rowIdx) ?? [])
              .sort((a, b) => a.colIndex - b.colIndex)
              .map((seat) => {
                const isTarget = seat.id === seatId;
                return (
                  <div
                    key={seat.id}
                    title={isTarget ? `Seat ${seat.seatLabel}${studentLabel ? ` — ${studentLabel}` : ''}` : seat.seatLabel}
                    aria-label={isTarget ? `Seat ${seat.seatLabel}, the seat this incident concerns${studentLabel ? `, ${studentLabel}` : ''}` : `Seat ${seat.seatLabel}`}
                    className={[
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded border font-mono text-[10px]',
                      isTarget ? 'border-danger-border bg-danger-text text-white' : 'border-border bg-surface text-text-muted',
                    ].join(' ')}
                  >
                    {seat.seatLabel}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted">Highlighted seat is the one this incident concerns.</p>
    </div>
  );
}
