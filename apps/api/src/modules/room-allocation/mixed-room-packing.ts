export interface PackGroup {
  quizId: string;
  count: number;
}

export interface PackRoom {
  roomId: string;
  /** Active seats. */
  capacity: number;
}

export interface PackPlacement {
  roomId: string;
  quizId: string;
  count: number;
}

/**
 * Mixed packing for sessions with SEVERAL subjects (quizzes) in SEVERAL rooms: every room used gets a
 * mix of every subject, in proportion to its size, so neighbours can take different papers. (Best-Fit
 * Decreasing keeps each subject whole in the smallest room it fits, which tends to give one subject per
 * room — nothing left for the seating step to mix.)
 *
 *  1. Use as few rooms as possible: the biggest rooms first, until their seats cover all students.
 *  2. Each chosen room is loaded in proportion to its capacity, so every room keeps similar spare room.
 *  3. Each subject (biggest first) is divided across the rooms in proportion to the places still open
 *     in each room, using largest remainders so the counts add up exactly and no room overflows.
 *
 * Deterministic. Throws if the seats cannot cover the students (the caller checks capacity first).
 * `options.useAllRooms` skips step 1 and spreads over every room given.
 */
export function packMixed(groups: PackGroup[], rooms: PackRoom[], options: { useAllRooms?: boolean } = {}): PackPlacement[] {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const usable = rooms.filter((r) => r.capacity > 0);
  const byCapacity = usable
    .map((room, order) => ({ room, order }))
    .sort((a, b) => b.room.capacity - a.room.capacity || a.order - b.order)
    .map((x) => x.room);

  // Normally as few rooms as possible; `useAllRooms` keeps every given room in play (rooms that already exist must not be
  // dropped when more rooms are added), each loaded in proportion to its size.
  const chosen: PackRoom[] = [];
  let seats = 0;
  for (const room of options.useAllRooms ? usable : byCapacity) {
    if (!options.useAllRooms && seats >= total) break;
    chosen.push(room);
    seats += room.capacity;
  }
  if (seats < total) {
    throw new Error('Not enough seats for the students.');
  }

  const loads = apportion(total, chosen.map((r) => r.capacity));
  const open = [...loads];
  const placements: PackPlacement[] = [];
  for (const group of [...groups].sort((a, b) => b.count - a.count)) {
    const shares = apportion(group.count, open);
    shares.forEach((count, i) => {
      if (count > 0) {
        placements.push({ roomId: chosen[i].roomId, quizId: group.quizId, count });
        open[i] -= count;
      }
    });
  }
  return placements;
}

/** Splits `amount` into integer parts proportional to `weights` (largest remainder; ties to the earlier entry). Parts never exceed their weight when amount <= sum(weights). */
function apportion(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    if (parts[i] < weights[i]) {
      parts[i] += 1;
      left -= 1;
    }
  }
  return parts;
}
