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
    case 'SEAT_ASSIGNED':
      return {
        title: 'Seat assigned',
        body: `You have been assigned room ${str(payload.room_label)}, seat ${str(
          payload.seat_label,
        )} for your upcoming exam.`,
      };
    case 'EXAM_SESSION_RESCHEDULED':
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
    case 'INCIDENT_STATUS_UPDATED':
      return {
        title: 'Incident update',
        body: `An incident concerning you has been updated to status ${str(payload.status)}.`,
      };
    case 'REPORT_READY':
      return {
        title: 'Report ready',
        body: `Your ${str(payload.report_type)} report is ready to download.`,
      };
    default: {
      const exhaustiveCheck: never = eventType;
      throw new Error(`Unknown notification event_type: ${String(exhaustiveCheck)}`);
    }
  }
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
