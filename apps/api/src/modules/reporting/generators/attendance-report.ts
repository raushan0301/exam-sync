import { ReportTable } from './report-table';

export interface AttendanceReportInputRow {
  quizStudentAssignment: {
    student: { name: string; rollNumber: string };
    quiz: { title: string };
  };
  seat: { seatLabel: string } | null;
  status: string;
  method: string;
  markedAt: Date;
  locked: boolean;
}

/** `POST /reports/attendance` — one row per `attendance` record in the session. */
export function buildAttendanceReportTable(rows: AttendanceReportInputRow[]): ReportTable {
  return {
    headers: ['Roll Number', 'Student Name', 'Quiz', 'Seat', 'Status', 'Method', 'Marked At', 'Locked'],
    rows: rows.map((r) => [
      r.quizStudentAssignment.student.rollNumber,
      r.quizStudentAssignment.student.name,
      r.quizStudentAssignment.quiz.title,
      r.seat?.seatLabel ?? '',
      r.status,
      r.method,
      r.markedAt.toISOString(),
      r.locked ? 'Yes' : 'No',
    ]),
  };
}
