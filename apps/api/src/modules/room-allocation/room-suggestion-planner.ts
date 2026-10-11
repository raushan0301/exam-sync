/**
 * Pure planning functions for room suggestions (no database): which rooms to use for N students.
 *
 * The default rule is "stay together": use ONE building if it can hold everyone, fill its floors from the
 * ground up one at a time (a floor is used up before the next one starts), and only spread over several
 * buildings when no single building is big enough. "Fewest rooms" ignores location entirely and is only
 * offered as an ALTERNATIVE when it needs fewer rooms than staying together — the person then chooses.
 * Only building and floor numbers are used; there is no notion of walking distance.
 */
export interface PoolRoom {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  /** Seats that can actually be used (all active seats, or only the kept columns when empty columns are planned). */
  capacity: number;
}

export interface PlannedRoom extends PoolRoom {
  allocated: number;
}

export interface RoomPlan {
  rooms: PlannedRoom[];
  /** "Building B · floors 0–1" — a short, human summary of where the rooms are. */
  location: string;
  spansBuildings: boolean;
}

const naturalRoomNumber = (a: PoolRoom, b: PoolRoom) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });

/** Fills rooms in the given order until `students` are placed (each room to capacity). Stops as soon as everyone is placed. */
export function greedyFill(ordered: PoolRoom[], students: number): PlannedRoom[] {
  const rooms: PlannedRoom[] = [];
  let remaining = students;
  for (const r of ordered) {
    if (remaining <= 0) break;
    if (r.capacity <= 0) continue;
    const allocated = Math.min(remaining, r.capacity);
    rooms.push({ ...r, allocated });
    remaining -= allocated;
  }
  return rooms;
}

/** Fewest rooms possible: biggest rooms first, wherever they are. */
export function fewestRoomsPlan(pool: PoolRoom[], students: number): RoomPlan {
  const rooms = greedyFill([...pool].sort((a, b) => b.capacity - a.capacity || a.building.localeCompare(b.building) || a.floor - b.floor || naturalRoomNumber(a, b)), students);
  return withLocation(rooms);
}

/** Order inside one building: lowest floor first; within a floor the biggest rooms first, then room number. */
function buildingOrder(rooms: PoolRoom[]): PoolRoom[] {
  return [...rooms].sort((a, b) => a.floor - b.floor || b.capacity - a.capacity || naturalRoomNumber(a, b));
}

/** Stay together: one building if it fits (the one needing the fewest rooms, then the fewest floors, then by name), floors filled one by one. */
export function togetherPlan(pool: PoolRoom[], students: number): RoomPlan {
  const byBuilding = new Map<string, PoolRoom[]>();
  for (const room of pool) {
    const list = byBuilding.get(room.building);
    if (list) list.push(room);
    else byBuilding.set(room.building, [room]);
  }
  const capacityOf = (rooms: PoolRoom[]) => rooms.reduce((sum, r) => sum + r.capacity, 0);

  const fitting = [...byBuilding.entries()]
    .filter(([, rooms]) => capacityOf(rooms) >= students)
    .map(([building, rooms]) => {
      const planned = greedyFill(buildingOrder(rooms), students);
      return { building, planned, floors: new Set(planned.map((r) => r.floor)).size };
    })
    .sort((a, b) => a.planned.length - b.planned.length || a.floors - b.floors || a.building.localeCompare(b.building));

  if (fitting.length > 0) return withLocation(fitting[0].planned);

  // No single building is big enough: take the biggest building first, then the next, each filled floor by floor.
  const buildingsBySize = [...byBuilding.entries()].sort(
    ([nameA, a], [nameB, b]) => capacityOf(b) - capacityOf(a) || nameA.localeCompare(nameB),
  );
  return withLocation(greedyFill(buildingsBySize.flatMap(([, rooms]) => buildingOrder(rooms)), students));
}

/** Same rooms, students spread evenly instead of filling each to the brim (each room capped at its own capacity). */
export function spreadEvenly(plan: RoomPlan, students: number): RoomPlan {
  if (plan.rooms.length === 0) return plan;
  let remaining = students;
  const rooms = plan.rooms.map((r) => ({ ...r, allocated: 0 }));
  const base = Math.floor(students / rooms.length);
  for (const r of rooms) {
    r.allocated = Math.min(base, r.capacity);
    remaining -= r.allocated;
  }
  // Hand out the remainder one at a time, round and round, to rooms that still have a free seat.
  while (remaining > 0 && rooms.some((r) => r.allocated < r.capacity)) {
    for (const r of rooms) {
      if (remaining <= 0) break;
      if (r.allocated < r.capacity) {
        r.allocated += 1;
        remaining -= 1;
      }
    }
  }
  return { ...plan, rooms };
}

function withLocation(rooms: PlannedRoom[]): RoomPlan {
  return { rooms, location: describeLocation(rooms), spansBuildings: new Set(rooms.map((r) => r.building)).size > 1 };
}

/** "Building B · floors 0–1", or "Building B · floor 2 + Building C · floor 0" when it spans buildings. */
export function describeLocation(rooms: PoolRoom[]): string {
  if (rooms.length === 0) return '';
  const floorsByBuilding = new Map<string, Set<number>>();
  for (const r of rooms) {
    const floors = floorsByBuilding.get(r.building) ?? new Set<number>();
    floors.add(r.floor);
    floorsByBuilding.set(r.building, floors);
  }
  return [...floorsByBuilding.entries()]
    .map(([building, floors]) => `Building ${building} · ${describeFloors([...floors].sort((a, b) => a - b))}`)
    .join(' + ');
}

function describeFloors(floors: number[]): string {
  if (floors.length === 1) return `floor ${floors[0]}`;
  const contiguous = floors.every((f, i) => i === 0 || f === floors[i - 1] + 1);
  return contiguous ? `floors ${floors[0]}–${floors[floors.length - 1]}` : `floors ${floors.join(', ')}`;
}

/**
 * Extra rooms for a session that already has rooms: the free rooms CLOSEST to the ones it uses — same building and floor
 * first, then the same building (nearest floor first, ground floor first on ties), then other buildings (by name) — each
 * tier biggest room first, taking rooms until `seatsNeeded` seats are covered. Only building and floor numbers count.
 */
export function nearestToExistingPlan(
  pool: PoolRoom[],
  existing: { building: string; floor: number }[],
  seatsNeeded: number,
): RoomPlan {
  const floorsByBuilding = new Map<string, number[]>();
  for (const e of existing) floorsByBuilding.set(e.building, [...(floorsByBuilding.get(e.building) ?? []), e.floor]);

  const tierOf = (room: PoolRoom): [number, number] => {
    const floors = floorsByBuilding.get(room.building);
    if (!floors) return [2, 0];
    if (floors.includes(room.floor)) return [0, 0];
    return [1, Math.min(...floors.map((f) => Math.abs(f - room.floor)))];
  };

  const ordered = [...pool].sort((a, b) => {
    const [tierA, distA] = tierOf(a);
    const [tierB, distB] = tierOf(b);
    return (
      tierA - tierB ||
      distA - distB ||
      (tierA === 2 ? a.building.localeCompare(b.building) : 0) ||
      a.floor - b.floor ||
      b.capacity - a.capacity ||
      naturalRoomNumber(a, b)
    );
  });
  return withLocation(greedyFill(ordered, Math.max(0, seatsNeeded)));
}
