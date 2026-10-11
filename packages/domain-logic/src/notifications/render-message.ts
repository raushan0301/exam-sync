import { NotificationEventTypeName, RenderedMessage } from './types';

/**
 * Renders a notification's title/body from its `event_type` + `payload`
 * (ARCHITECTURE.md §AB's flow diagram: "worker pool consumes -> renders
 * template -> sends via provider").
 *
 * Disclosed scope decision (Phase 15): no DB-backed "notification
 * template" system exists anywhere in the authoritative docs —
 * PRD.md/BUSINESS_RULES.md/API_CONTRACT.md/ARCHITECTURE.md never describe
 * template CRUD, template storage, or admin-editable copy. "Renders
 * template" (§AB) is read literally as *this* — a fixed, per-event-type
 * rendering function — rather than invented as an undocumented
 * database-backed feature. Same applies to user notification
 * preferences/opt-out: no such mechanism is documented anywhere, so none
 * is implemented; every notification FR-041 requires is always sent.
 */
export function renderMessage(
  eventType: NotificationEventTypeName,
  payload: Record<string, unknown>,
): RenderedMessage {
  switch (eventType) {
    case 'QUIZ_APPROVED':
      return {
        title: 'Quiz approved',
        body: `Your quiz "${str(payload.quiz_title)}" has been approved.`,
      };
    case 'QUIZ_REJECTED':
      return {
        title: 'Quiz rejected',
        body: `Your quiz "${str(payload.quiz_title)}" was rejected. Reason: ${str(payload.reason)}`,
      };
    case 'QUIZ_SUBMITTED':
      return {
        title: 'Quiz awaiting review',
        body: `"${str(payload.quiz_title)}" was submitted and is waiting for approval.`,
      };
    case 'SEAT_ASSIGNED': {
      const session = str(payload.session_name);
      const date = str(payload.session_date);
      return {
        title: 'Seat assigned',
        body: `You have been assigned room ${str(payload.room_label)}, seat ${str(payload.seat_label)} for ${
          session ? `"${session}"` : 'your upcoming exam'
        }${date ? ` on ${date}` : ''}.`,
      };
    }
    case 'EXAM_SESSION_RESCHEDULED':
      if (payload.as_invigilator) {
        const room = str(payload.room_label);
        return {
          title: 'Invigilation rescheduled',
          body: `"${str(payload.session_name)}", which you invigilate${room ? ` in room ${room}` : ''}, has been rescheduled to ${str(
            payload.session_date,
          )} ${str(payload.start_time)}-${str(payload.end_time)}.`,
        };
      }
      return {
        title: 'Exam rescheduled',
        body: `"${str(payload.session_name)}" has been rescheduled to ${str(payload.session_date)} ${str(
          payload.start_time,
        )}-${str(payload.end_time)}.`,
      };
    case 'EXAM_SESSION_CANCELLED':
      return {
        title: 'Exam cancelled',
        body: `"${str(payload.session_name)}" has been cancelled. Reason: ${str(payload.reason)}`,
      };
    case 'SUSPENSION_REQUESTED':
      return {
        title: 'Suspension requested',
        body: `${str(payload.faculty_name) || 'A faculty member'} asked to suspend "${str(
          payload.session_name,
        )}". Reason: ${str(payload.reason)}`,
      };
    case 'SUSPENSION_APPROVED':
      return {
        title: 'Suspension approved',
        body: `Your request to suspend "${str(payload.session_name)}" was approved. The session is cancelled and its resources are released.${
          str(payload.note) ? ` Note: ${str(payload.note)}` : ''
        }`,
      };
    case 'SUSPENSION_REJECTED':
      return {
        title: 'Suspension declined',
        body: `Your request to suspend "${str(payload.session_name)}" was declined. Reason: ${str(payload.note)}`,
      };
    case 'INVIGILATOR_ASSIGNED': {
      const room = str(payload.room_label);
      const date = str(payload.session_date);
      const start = str(payload.start_time);
      const end = str(payload.end_time);
      return {
        title: 'Invigilator duty assigned',
        body: `You have been assigned as ${roleLabel(payload.role)} for "${str(payload.session_name)}"${room ? ` in room ${room}` : ''}${
          date ? ` on ${date}` : ''
        }${start ? ` at ${start}${end ? `-${end}` : ''}` : ''}.`,
      };
    }
    case 'INVIGILATOR_REMOVED': {
      const room = str(payload.room_label);
      const reason = str(payload.reason);
      return payload.cause === 'SESSION_CANCELLED'
        ? {
            title: 'Invigilator duty cancelled',
            body: `"${str(payload.session_name)}" was cancelled, so your invigilator duty${room ? ` in room ${room}` : ''} is cancelled.${
              reason ? ` Reason: ${reason}` : ''
            }`,
          }
        : {
            title: 'Invigilator duty removed',
            body: `You are no longer assigned to invigilate "${str(payload.session_name)}"${room ? ` in room ${room}` : ''}.`,
          };
    }
    case 'ROOM_HOLD_RELEASED': {
      const quiz = str(payload.quiz_title);
      const when = [str(payload.hold_date), str(payload.start_time)].filter(Boolean).join(' ');
      return {
        title: 'Held rooms released',
        body: `The rooms held for "${quiz}"${when ? ` on ${when}` : ''} were released: ${releaseReasonText(payload.reason)} Availability will be checked again when you request rooms.`,
      };
    }
    case 'BACKUP_ROOM_USED': {
      const session = str(payload.session_name);
      return {
        title: 'Backup room used',
        body: `${str(payload.unavailable_room) ? `Room ${str(payload.unavailable_room)} was unavailable` : 'A held room was unavailable'}${
          session ? ` for "${session}"` : ''
        }, so the backup room ${str(payload.backup_room)} was used instead.`,
      };
    }
    case 'ROOM_REQUEST_SUBMITTED': {
      const count = Number(payload.room_count) || 0;
      return {
        title: 'More rooms requested',
        body: `${str(payload.faculty_name) || 'A faculty member'} asked for ${count > 0 ? `${count} more room${count === 1 ? '' : 's'}` : 'more rooms'} for "${str(
          payload.session_name,
        )}" during seating. Reason: ${str(payload.reason)} Review it under Room Requests.`,
      };
    }
    case 'ROOM_REQUEST_APPROVED': {
      const rooms = str(payload.rooms);
      return {
        title: 'More rooms approved',
        body: `Your request for more rooms for "${str(payload.session_name)}" was approved${
          rooms ? `: ${rooms} added` : ''
        }. Students in rooms that are not finalized were re-split — generate seating for those rooms again.${str(payload.note) ? ` Note: ${str(payload.note)}` : ''}`,
      };
    }
    case 'ROOM_REQUEST_REJECTED':
      return {
        title: 'More rooms declined',
        body: `Your request for more rooms for "${str(payload.session_name)}" was declined. Reason: ${str(payload.note)} Seating continues as before.`,
      };
    case 'INCIDENT_STATUS_UPDATED':
      // Admin notifications carry a complete, specific sentence (and title) written by
      // the incidents service; the generic wording is only the fallback for payloads without one.
      return {
        title: str(payload.title) || 'Incident update',
        body: str(payload.message) || `An incident concerning you has been updated to status ${str(payload.status)}.`,
      };
    case 'REPORT_READY': {
      const label = str(payload.report_label) || `${str(payload.report_type)} report`;
      const session = str(payload.session_name);
      return {
        title: 'Report ready',
        body: `Your ${label}${session ? ` for "${session}"` : ''} is ready to download.`,
      };
    }
    default: {
      const exhaustiveCheck: never = eventType;
      throw new Error(`Unknown notification event_type: ${String(exhaustiveCheck)}`);
    }
  }
}

function releaseReasonText(reason: unknown): string {
  return reason === 'SESSION_CANCELLED'
    ? 'the exam session was cancelled.'
    : reason === 'TIME_CHANGED'
      ? 'the exam session was created for a different date or time.'
      : 'they are no longer needed.';
}

function roleLabel(role: unknown): string {
  return role === 'LEAD_INVIGILATOR' ? 'lead invigilator' : role === 'ASSISTANT_INVIGILATOR' ? 'assistant invigilator' : 'an invigilator';
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
