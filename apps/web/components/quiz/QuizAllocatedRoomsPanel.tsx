import type { QuizDetail } from '@/lib/queries/types';

export interface QuizAllocatedRoomsPanelProps {
  quiz: QuizDetail;
}

/**
 * Read-only "final answer" card: once this quiz's exam session has had
 * rooms actually approved/allocated (`exam_session_rooms`, via
 * RoomAllocationService.allocate — the real, seat-counted booking, not
 * the preliminary `requestedRoomIds` recommendation), show exactly what
 * was booked. Shown to both FACULTY and ADMIN whenever it exists,
 * regardless of quiz status.
 */
export function QuizAllocatedRoomsPanel({ quiz }: QuizAllocatedRoomsPanelProps) {
  const rooms = quiz.examSession?.rooms ?? [];
  if (rooms.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {rooms.map((r) => (
        <li key={r.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
          <span className="text-text">
            {r.building} · Floor {r.floor} · Room {r.roomNumber}
          </span>
          <span className="text-text-muted">
            {r.allocatedCapacity} / {r.capacity} seats
          </span>
        </li>
      ))}
    </ul>
  );
}
