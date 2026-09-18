import { ReportTable } from './report-table';

export interface RoomUtilizationReportInputRow {
  room: { building: string; roomNumber: string; capacity: number };
  allocatedCapacity: number;
  seatsUsed: number;
}

/** `POST /reports/room-utilization` — one row per room allocated to the session. `utilization_pct` is against the room's own total seat `capacity`, not the (possibly smaller) `allocatedCapacity` — the more meaningful "how full is this physical room" figure. */
export function buildRoomUtilizationReportTable(rows: RoomUtilizationReportInputRow[]): ReportTable {
  return {
    headers: ['Room', 'Capacity', 'Allocated Capacity', 'Seats Used', 'Utilization %'],
    rows: rows.map((r) => [
      `${r.room.building}-${r.room.roomNumber}`,
      r.room.capacity,
      r.allocatedCapacity,
      r.seatsUsed,
      r.room.capacity > 0 ? Math.round((r.seatsUsed / r.room.capacity) * 1000) / 10 : 0,
    ]),
  };
}
