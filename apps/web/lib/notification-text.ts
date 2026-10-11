export interface NotificationText {
  title: string;
  body: string;
}

const REPORT_LABELS: Record<string, string> = {
  ATTENDANCE: 'Attendance Report',
  SEATING_PLAN: 'Seating Plan Report',
  INCIDENT_REPORT: 'Incident Report',
  ROOM_UTILIZATION: 'Room Utilization Report',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** "CHEATING_SUSPICION" -> "Cheating suspicion". */
function humanizeEnum(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const quoted = (name: string) => (name ? `“${name}”` : 'an exam');

/**
 * Turns a notification's event type + payload into a clear, human title and
 * sentence. Prefers the specific wording the server put in the payload
 * (`title` / `message`, used by incident notifications), and otherwise builds
 * it from the structured fields — so older rows that only carry raw ids/enums
 * still read sensibly instead of showing just "Report ready".
 */
export function describeNotification(eventType: string, payload: Record<string, unknown> | null | undefined): NotificationText {
  const p = payload ?? {};

  switch (eventType) {
    case 'QUIZ_APPROVED': {
      const quiz = str(p.quiz_title);
      return { title: 'Quiz approved', body: quiz ? `Your quiz “${quiz}” was approved.` : 'Your quiz was approved.' };
    }
    case 'QUIZ_REJECTED': {
      const quiz = str(p.quiz_title);
      const reason = str(p.reason);
      return {
        title: 'Quiz rejected',
        body: `${quiz ? `Your quiz “${quiz}”` : 'Your quiz'} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
      };
    }
    case 'QUIZ_SUBMITTED': {
      const quiz = str(p.quiz_title);
      return {
        title: 'Quiz awaiting review',
        body: quiz ? `“${quiz}” was submitted and is waiting for approval.` : 'A quiz was submitted and is waiting for approval.',
      };
    }
    case 'SEAT_ASSIGNED': {
      const room = str(p.room_label);
      const seat = str(p.seat_label);
      const session = str(p.session_name);
      const date = str(p.session_date);
      const time = str(p.start_time).slice(0, 5);
      const where = [room && `room ${room}`, seat && `seat ${seat}`].filter(Boolean).join(', ');
      const when = date ? ` on ${formatDate(date)}${time ? ` at ${time}` : ''}` : '';
      return {
        title: 'Seat assigned',
        body: `You have been assigned ${where || 'a seat'} for ${quoted(session)}${when}.`,
      };
    }
    case 'EXAM_SESSION_RESCHEDULED': {
      const session = str(p.session_name);
      const date = str(p.session_date);
      const start = str(p.start_time).slice(0, 5);
      const end = str(p.end_time).slice(0, 5);
      const when = date ? ` to ${formatDate(date)}${start ? `, ${start}${end ? `–${end}` : ''}` : ''}` : '';
      if (p.as_invigilator) {
        const room = str(p.room_label);
        return {
          title: 'Invigilation rescheduled',
          body: `${quoted(session)}, which you invigilate${room ? ` in room ${room}` : ''}, has been rescheduled${when}.`,
        };
      }
      return { title: 'Exam rescheduled', body: `${quoted(session)} has been rescheduled${when}.` };
    }
    case 'EXAM_SESSION_CANCELLED': {
      const reason = str(p.reason);
      return {
        title: 'Exam cancelled',
        body: `${quoted(str(p.session_name))} has been cancelled.${reason ? ` Reason: ${reason}` : ''}`,
      };
    }
    case 'SUSPENSION_REQUESTED': {
      const faculty = str(p.faculty_name) || 'A faculty member';
      const reason = str(p.reason);
      return {
        title: 'Suspension requested',
        body: `${faculty} asked to suspend ${quoted(str(p.session_name))}.${reason ? ` Reason: ${reason}` : ''} Review it under Suspension Requests.`,
      };
    }
    case 'SUSPENSION_APPROVED': {
      const note = str(p.note);
      return {
        title: 'Suspension approved',
        body: `Your request to suspend ${quoted(str(p.session_name))} was approved. The session is cancelled and its resources are released.${note ? ` Admin note: ${note}` : ''}`,
      };
    }
    case 'SUSPENSION_REJECTED': {
      const note = str(p.note);
      return {
        title: 'Suspension declined',
        body: `Your request to suspend ${quoted(str(p.session_name))} was declined${note ? `: ${note}` : '.'} The session stays scheduled.`,
      };
    }
    case 'INVIGILATOR_ASSIGNED': {
      const room = str(p.room_label);
      const date = str(p.session_date);
      const start = str(p.start_time).slice(0, 5);
      const end = str(p.end_time).slice(0, 5);
      const role = p.role === 'LEAD_INVIGILATOR' ? 'lead invigilator' : p.role === 'ASSISTANT_INVIGILATOR' ? 'assistant invigilator' : 'an invigilator';
      const when = date ? ` on ${formatDate(date)}${start ? ` at ${start}${end ? `–${end}` : ''}` : ''}` : '';
      return {
        title: 'Invigilator duty assigned',
        body: `You have been assigned as ${role} for ${quoted(str(p.session_name))}${room ? ` in room ${room}` : ''}${when}.`,
      };
    }
    case 'INVIGILATOR_REMOVED': {
      const room = str(p.room_label);
      const reason = str(p.reason);
      return p.cause === 'SESSION_CANCELLED'
        ? {
            title: 'Invigilator duty cancelled',
            body: `${quoted(str(p.session_name))} was cancelled, so your invigilator duty${room ? ` in room ${room}` : ''} is cancelled.${reason ? ` Reason: ${reason}` : ''}`,
          }
        : {
            title: 'Invigilator duty removed',
            body: `You are no longer assigned to invigilate ${quoted(str(p.session_name))}${room ? ` in room ${room}` : ''}.`,
          };
    }
    case 'INCIDENT_STATUS_UPDATED': {
      const message = str(p.message);
      // Older rows embed a raw enum in the sentence ("…reported: CHEATING_SUSPICION.") — tidy it.
      const tidy = message.replace(/(?<=: )[A-Z][A-Z_]+(?=\.)/, (m) => humanizeEnum(m));
      const status = str(p.status);
      return {
        title: str(p.title) || 'Incident update',
        body: tidy || (status ? `An incident is now ${humanizeEnum(status).toLowerCase()}.` : 'An incident was updated.'),
      };
    }
    case 'REPORT_READY': {
      const label = str(p.report_label) || REPORT_LABELS[str(p.report_type)] || 'report';
      const session = str(p.session_name);
      return {
        title: 'Report ready',
        body: `Your ${label}${session ? ` for ${quoted(session)}` : ''} is ready to download.`,
      };
    }
    default:
      return { title: humanizeEnum(eventType), body: str(p.message) };
  }
}
