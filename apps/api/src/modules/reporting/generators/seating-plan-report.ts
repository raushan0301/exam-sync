import { ReportTable } from './report-table';

export interface SeatingPlanReportInputPlan {
  status: string;
  room: { building: string; roomNumber: string };
  assignments: {
    seat: { seatLabel: string };
    student: { name: string; rollNumber: string };
    quiz: { title: string };
  }[];
}

/** `POST /reports/seating-plan` — one row per seat assignment, across every room's plan for the session (a session has one `seating_plan` per allocated room, DOMAIN_MODEL.md §6). */
export function buildSeatingPlanReportTable(plans: SeatingPlanReportInputPlan[]): ReportTable {
  const rows: (string | number | null)[][] = [];
  for (const plan of plans) {
    for (const a of plan.assignments) {
      rows.push([
        `${plan.room.building}-${plan.room.roomNumber}`,
        a.seat.seatLabel,
        a.student.rollNumber,
        a.student.name,
        a.quiz.title,
        plan.status,
      ]);
    }
  }
  return {
    headers: ['Room', 'Seat', 'Roll Number', 'Student Name', 'Quiz', 'Plan Status'],
    rows,
  };
}
