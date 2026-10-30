import type { SharedHold } from '@/lib/queries/types';

const seats = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;

/**
 * One line saying another approved quiz already holds seats in this room at the same time — so a room that shows as
 * "available" is understood to be shared, not empty. `left` is the seats still free for this request when known.
 */
export function SharedRoomNote({ sharedWith, left, className }: { sharedWith?: SharedHold[]; left?: number; className?: string }) {
  if (!sharedWith || sharedWith.length === 0) return null;
  const who = sharedWith.map((h) => `${h.quizTitle} holds ${seats(h.seats)}`).join(' · ');
  return (
    <p data-testid="shared-room-note" className={className ?? 'text-xs text-info-text'}>
      Shared room: {who} at this time{left !== undefined ? ` — ${left} seat${left === 1 ? '' : 's'} left for you` : ' — the room is shared, not full'}.
    </p>
  );
}
