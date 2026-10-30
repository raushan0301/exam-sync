import type { AvailableRoomOption, RoomSuggestionStrategy, SuggestedRoom } from './queries/types';

/**
 * Splits students over rooms the person picked by hand, the same way the server's suggestion does for each strategy
 * (see `room-suggestion-planner.ts` in the API — keep the two in step): "Fewest Classes" fills each room to the brim in
 * order; "Balanced Spread" gives every room an equal share, handing the remainder out one seat at a time.
 */
export interface CustomRoomPlan {
  rooms: SuggestedRoom[];
  roomCount: number;
  totalCapacity: number;
  utilizationPercent: number;
  /** "Building B · floors 0–1" */
  location: string;
  spansBuildings: boolean;
}

const byPlace = (a: AvailableRoomOption, b: AvailableRoomOption) =>
  a.building.localeCompare(b.building) ||
  a.floor - b.floor ||
  b.capacity - a.capacity ||
  a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });

function describeFloors(floors: number[]): string {
  if (floors.length === 1) return `floor ${floors[0]}`;
  const contiguous = floors.every((f, i) => i === 0 || f === floors[i - 1] + 1);
  return contiguous ? `floors ${floors[0]}–${floors[floors.length - 1]}` : `floors ${floors.join(', ')}`;
}

export function describeLocation(rooms: { building: string; floor: number }[]): string {
  const floorsByBuilding = new Map<string, Set<number>>();
  for (const r of rooms) floorsByBuilding.set(r.building, (floorsByBuilding.get(r.building) ?? new Set<number>()).add(r.floor));
  return [...floorsByBuilding.entries()]
    .map(([building, floors]) => `Building ${building} · ${describeFloors([...floors].sort((a, b) => a - b))}`)
    .join(' + ');
}

export function buildCustomPlan(
  strategy: RoomSuggestionStrategy,
  roomIds: string[],
  allRooms: AvailableRoomOption[],
  totalStudents: number,
): CustomRoomPlan {
  const byId = new Map(allRooms.map((r) => [r.roomId, r]));
  const chosen = roomIds.map((id) => byId.get(id)).filter((r): r is AvailableRoomOption => !!r && r.capacity > 0).sort(byPlace);

  const allocated = new Map<string, number>(chosen.map((r) => [r.roomId, 0]));
  if (strategy === 'BALANCED_SPREAD') {
    let remaining = totalStudents;
    const base = chosen.length === 0 ? 0 : Math.floor(totalStudents / chosen.length);
    for (const r of chosen) {
      const n = Math.min(base, r.capacity);
      allocated.set(r.roomId, n);
      remaining -= n;
    }
    while (remaining > 0 && chosen.some((r) => (allocated.get(r.roomId) ?? 0) < r.capacity)) {
      for (const r of chosen) {
        if (remaining <= 0) break;
        if ((allocated.get(r.roomId) ?? 0) < r.capacity) {
          allocated.set(r.roomId, (allocated.get(r.roomId) ?? 0) + 1);
          remaining -= 1;
        }
      }
    }
  } else {
    let remaining = totalStudents;
    for (const r of chosen) {
      const n = Math.min(remaining, r.capacity);
      allocated.set(r.roomId, n);
      remaining -= n;
    }
  }

  const rooms: SuggestedRoom[] = chosen.map((r) => ({
    roomId: r.roomId,
    building: r.building,
    floor: r.floor,
    roomNumber: r.roomNumber,
    capacity: r.capacity,
    allocated: allocated.get(r.roomId) ?? 0,
    ...(r.sharedWith?.length ? { sharedWith: r.sharedWith } : {}),
  }));
  const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
  const totalAllocated = rooms.reduce((sum, r) => sum + r.allocated, 0);
  return {
    rooms,
    roomCount: rooms.length,
    totalCapacity,
    utilizationPercent: totalCapacity === 0 ? 0 : Math.round((totalAllocated / totalCapacity) * 100),
    location: describeLocation(rooms),
    spansBuildings: new Set(rooms.map((r) => r.building)).size > 1,
  };
}

/** True when the rooms in the request are not exactly the rooms of the plan the person picked. */
export function differsFromPlan(planRoomIds: string[], roomIds: string[]): boolean {
  return planRoomIds.length !== roomIds.length || planRoomIds.some((id) => !roomIds.includes(id));
}
