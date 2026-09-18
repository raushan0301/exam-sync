import { ReportTable } from './report-table';

export interface IncidentReportInputRow {
  incidentType: string;
  severity: string;
  status: string;
  description: string;
  reportedByFaculty: { name: string };
  student: { name: string; rollNumber: string } | null;
  room: { building: string; roomNumber: string } | null;
  seat: { seatLabel: string } | null;
  resolution: string | null;
  createdAt: Date;
}

/** `POST /reports/incident-report` — one row per incident filed in the session. */
export function buildIncidentReportTable(rows: IncidentReportInputRow[]): ReportTable {
  return {
    headers: [
      'Type',
      'Severity',
      'Status',
      'Description',
      'Reported By',
      'Student Roll Number',
      'Student Name',
      'Room',
      'Seat',
      'Resolution',
      'Created At',
    ],
    rows: rows.map((r) => [
      r.incidentType,
      r.severity,
      r.status,
      r.description,
      r.reportedByFaculty.name,
      r.student?.rollNumber ?? '',
      r.student?.name ?? '',
      r.room ? `${r.room.building}-${r.room.roomNumber}` : '',
      r.seat?.seatLabel ?? '',
      r.resolution ?? '',
      r.createdAt.toISOString(),
    ]),
  };
}
