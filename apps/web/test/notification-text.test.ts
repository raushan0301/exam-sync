import { describe, expect, it } from 'vitest';
import { describeNotification } from '@/lib/notification-text';

describe('describeNotification — clear title + sentence for every event', () => {
  it('REPORT_READY names the report and the exam (new payloads)', () => {
    expect(
      describeNotification('REPORT_READY', { report_label: 'Incident Report', session_name: 'Cyber quiz 1 — Exam' }),
    ).toEqual({ title: 'Report ready', body: 'Your Incident Report for “Cyber quiz 1 — Exam” is ready to download.' });
  });

  it('REPORT_READY still reads well for OLDER rows that only have the raw report type', () => {
    expect(describeNotification('REPORT_READY', { report_type: 'ROOM_UTILIZATION', report_job_id: 'x' })).toEqual({
      title: 'Report ready',
      body: 'Your Room Utilization Report is ready to download.',
    });
  });

  it('INCIDENT_STATUS_UPDATED uses the server-written title and sentence', () => {
    expect(
      describeNotification('INCIDENT_STATUS_UPDATED', {
        title: 'Critical incident reported',
        message: 'Suspected cheating (critical severity) was reported during “Cyber quiz 1 — Exam”.',
      }),
    ).toEqual({
      title: 'Critical incident reported',
      body: 'Suspected cheating (critical severity) was reported during “Cyber quiz 1 — Exam”.',
    });
  });

  it('INCIDENT_STATUS_UPDATED tidies the raw enum inside OLDER stored messages', () => {
    expect(
      describeNotification('INCIDENT_STATUS_UPDATED', { message: 'A new incident was reported: CHEATING_SUSPICION.' }),
    ).toEqual({ title: 'Incident update', body: 'A new incident was reported: Cheating suspicion.' });
  });

  it('INCIDENT_STATUS_UPDATED with only a status falls back to a plain sentence', () => {
    expect(describeNotification('INCIDENT_STATUS_UPDATED', { status: 'UNDER_REVIEW' }).body).toBe('An incident is now under review.');
  });

  it('QUIZ_APPROVED / REJECTED / SUBMITTED name the quiz (and the rejection reason)', () => {
    expect(describeNotification('QUIZ_APPROVED', { quiz_title: 'DBMS Midterm' }).body).toBe('Your quiz “DBMS Midterm” was approved.');
    expect(describeNotification('QUIZ_REJECTED', { quiz_title: 'OS Quiz', reason: 'Too few questions' }).body).toBe(
      'Your quiz “OS Quiz” was rejected. Reason: Too few questions',
    );
    expect(describeNotification('QUIZ_SUBMITTED', { quiz_title: 'DBMS Midterm' })).toEqual({
      title: 'Quiz awaiting review',
      body: '“DBMS Midterm” was submitted and is waiting for approval.',
    });
  });

  it('SEAT_ASSIGNED says which exam, room, seat, and when', () => {
    const { title, body } = describeNotification('SEAT_ASSIGNED', {
      room_label: 'E-E-306', seat_label: 'A2', session_name: 'Cyber quiz 1 — Exam', session_date: '2026-09-22', start_time: '17:10:00',
    });
    expect(title).toBe('Seat assigned');
    expect(body).toContain('room E-E-306, seat A2');
    expect(body).toContain('“Cyber quiz 1 — Exam”');
    expect(body).toContain('at 17:10');
  });

  it('SEAT_ASSIGNED still works for older rows without the exam details', () => {
    expect(describeNotification('SEAT_ASSIGNED', { room_label: 'B-201', seat_label: 'R3C4' }).body).toBe(
      'You have been assigned room B-201, seat R3C4 for an exam.',
    );
  });

  it('EXAM_SESSION_RESCHEDULED / CANCELLED state the exam and the change', () => {
    const r = describeNotification('EXAM_SESSION_RESCHEDULED', { session_name: 'Finals', session_date: '2026-10-01', start_time: '10:00', end_time: '12:00' });
    expect(r.title).toBe('Exam rescheduled');
    expect(r.body).toContain('“Finals” has been rescheduled to');
    expect(r.body).toContain('10:00–12:00');
    expect(describeNotification('EXAM_SESSION_CANCELLED', { session_name: 'Finals', reason: 'Venue unavailable' }).body).toBe(
      '“Finals” has been cancelled. Reason: Venue unavailable',
    );
  });

  it('never throws and never shows "undefined" for missing or odd payloads', () => {
    for (const type of ['QUIZ_APPROVED', 'QUIZ_REJECTED', 'SEAT_ASSIGNED', 'EXAM_SESSION_RESCHEDULED', 'EXAM_SESSION_CANCELLED', 'INCIDENT_STATUS_UPDATED', 'REPORT_READY', 'SUSPENSION_REQUESTED', 'SUSPENSION_APPROVED', 'SUSPENSION_REJECTED', 'INVIGILATOR_ASSIGNED', 'INVIGILATOR_REMOVED', 'ROOM_HOLD_RELEASED', 'BACKUP_ROOM_USED', 'ROOM_REQUEST_SUBMITTED', 'ROOM_REQUEST_APPROVED', 'ROOM_REQUEST_REJECTED']) {
      for (const payload of [undefined, null, {}, { message: 42 }]) {
        const { title, body } = describeNotification(type, payload as never);
        expect(title).toBeTruthy();
        expect(`${title} ${body}`).not.toMatch(/undefined|null|\[object/);
      }
    }
  });

  it('unknown future event types fall back to a humanized name plus any message', () => {
    expect(describeNotification('SOMETHING_NEW_HAPPENED', { message: 'Hello' })).toEqual({ title: 'Something new happened', body: 'Hello' });
  });

  it('SUSPENSION_REQUESTED tells an admin who asked, for which exam, and why', () => {
    const { title, body } = describeNotification('SUSPENSION_REQUESTED', {
      faculty_name: 'Dr. Smith', session_name: 'Cyber quiz 1 — Exam', reason: 'The venue was double-booked.',
    });
    expect(title).toBe('Suspension requested');
    expect(body).toBe('Dr. Smith asked to suspend “Cyber quiz 1 — Exam”. Reason: The venue was double-booked. Review it under Suspension Requests.');
  });

  it('SUSPENSION_APPROVED / REJECTED tell the faculty the outcome, with the admin\'s note', () => {
    expect(describeNotification('SUSPENSION_APPROVED', { session_name: 'Finals', note: 'Rebook in November' })).toEqual({
      title: 'Suspension approved',
      body: 'Your request to suspend “Finals” was approved. The session is cancelled and its resources are released. Admin note: Rebook in November',
    });
    expect(describeNotification('SUSPENSION_REJECTED', { session_name: 'Finals', note: 'The exam must go ahead.' })).toEqual({
      title: 'Suspension declined',
      body: 'Your request to suspend “Finals” was declined: The exam must go ahead. The session stays scheduled.',
    });
    expect(describeNotification('SUSPENSION_APPROVED', { session_name: 'Finals' }).body).not.toContain('Admin note');
  });

  it('describes invigilator duty notifications in full sentences', () => {
    const assigned = describeNotification('INVIGILATOR_ASSIGNED', {
      session_name: 'Finals',
      room_label: 'B-107',
      session_date: '2027-02-01',
      start_time: '09:00',
      end_time: '10:00',
      role: 'ASSISTANT_INVIGILATOR',
    });
    expect(assigned.title).toBe('Invigilator duty assigned');
    expect(assigned.body).toContain('assigned as assistant invigilator for “Finals” in room B-107');
    expect(assigned.body).toContain('09:00–10:00');

    expect(describeNotification('INVIGILATOR_REMOVED', { session_name: 'Finals', room_label: 'B-107', cause: 'REMOVED' })).toEqual({
      title: 'Invigilator duty removed',
      body: 'You are no longer assigned to invigilate “Finals” in room B-107.',
    });
    expect(
      describeNotification('INVIGILATOR_REMOVED', { session_name: 'Finals', room_label: 'B-107', cause: 'SESSION_CANCELLED', reason: 'Venue unavailable' }),
    ).toEqual({
      title: 'Invigilator duty cancelled',
      body: '“Finals” was cancelled, so your invigilator duty in room B-107 is cancelled. Reason: Venue unavailable',
    });
  });

  it('EXAM_SESSION_RESCHEDULED for an invigilator names their room and says they invigilate it', () => {
    const r = describeNotification('EXAM_SESSION_RESCHEDULED', {
      session_name: 'Finals',
      session_date: '2026-10-01',
      start_time: '10:00',
      end_time: '12:00',
      as_invigilator: true,
      room_label: 'B-107, B-108',
    });
    expect(r.title).toBe('Invigilation rescheduled');
    expect(r.body).toContain('“Finals”, which you invigilate in room B-107, B-108, has been rescheduled to');
    expect(r.body).toContain('10:00–12:00');
  });

  it('describes held-room releases and the automatic backup room', () => {
    const released = describeNotification('ROOM_HOLD_RELEASED', { quiz_title: 'DBMS', hold_date: '2027-03-01', start_time: '09:00', reason: 'TIME_CHANGED' });
    expect(released.title).toBe('Held rooms released');
    expect(released.body).toContain('The rooms held for “DBMS”');
    expect(released.body).toContain('different date or time');
    expect(describeNotification('ROOM_HOLD_RELEASED', { quiz_title: 'DBMS', reason: 'SESSION_CANCELLED' }).body).toContain('the exam session was cancelled');

    expect(describeNotification('BACKUP_ROOM_USED', { session_name: 'Finals', unavailable_room: 'B-105', backup_room: 'B-204' })).toEqual({
      title: 'Backup room used',
      body: 'Room B-105 was unavailable for “Finals”, so the backup room B-204 was used instead.',
    });
  });

  it('describes the "more rooms" request, approval and decline', () => {
    expect(describeNotification('ROOM_REQUEST_SUBMITTED', { faculty_name: 'Jaskirat Singh', session_name: 'Finals', room_count: 1, reason: 'Too many students.' }).body).toBe(
      'Jaskirat Singh asked for 1 more room for “Finals” during seating. Reason: Too many students. Review it under Room Requests.',
    );
    expect(describeNotification('ROOM_REQUEST_APPROVED', { session_name: 'Finals', rooms: 'B-201', note: 'ok' }).body).toContain('approved: B-201 added.');
    expect(describeNotification('ROOM_REQUEST_REJECTED', { session_name: 'Finals', note: 'No free room.' })).toEqual({
      title: 'More rooms declined',
      body: 'Your request for more rooms for “Finals” was declined: No free room. Seating continues as before.',
    });
  });
});
