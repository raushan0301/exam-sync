import { renderMessage } from './render-message';

describe('renderMessage', () => {
  it('renders QUIZ_APPROVED', () => {
    const msg = renderMessage('QUIZ_APPROVED', { quiz_title: 'DBMS Midterm' });
    expect(msg.title).toBe('Quiz approved');
    expect(msg.body).toContain('DBMS Midterm');
  });

  it('renders QUIZ_REJECTED including the reason', () => {
    const msg = renderMessage('QUIZ_REJECTED', { quiz_title: 'OS Quiz', reason: 'Incomplete questions' });
    expect(msg.body).toContain('OS Quiz');
    expect(msg.body).toContain('Incomplete questions');
  });

  it('renders SEAT_ASSIGNED with room and seat labels', () => {
    const msg = renderMessage('SEAT_ASSIGNED', { room_label: 'B-201', seat_label: 'R3C4' });
    expect(msg.body).toContain('B-201');
    expect(msg.body).toContain('R3C4');
  });

  it('renders EXAM_SESSION_RESCHEDULED with new date/time', () => {
    const msg = renderMessage('EXAM_SESSION_RESCHEDULED', {
      session_name: 'Midterms Week 1',
      session_date: '2026-10-01',
      start_time: '10:00',
      end_time: '12:00',
    });
    expect(msg.body).toContain('Midterms Week 1');
    expect(msg.body).toContain('2026-10-01');
  });

  it('renders EXAM_SESSION_CANCELLED with reason', () => {
    const msg = renderMessage('EXAM_SESSION_CANCELLED', {
      session_name: 'Finals',
      reason: 'Venue unavailable',
    });
    expect(msg.body).toContain('Finals');
    expect(msg.body).toContain('Venue unavailable');
  });

  it('renders QUIZ_SUBMITTED', () => {
    const msg = renderMessage('QUIZ_SUBMITTED', { quiz_title: 'DBMS Midterm' });
    expect(msg.title).toBe('Quiz awaiting review');
    expect(msg.body).toContain('DBMS Midterm');
  });

  it('SEAT_ASSIGNED names the exam and date when the payload has them', () => {
    const msg = renderMessage('SEAT_ASSIGNED', {
      room_label: 'E-E-306', seat_label: 'A2', session_name: 'Cyber quiz 1 — Exam', session_date: '2026-09-22',
    });
    expect(msg.body).toBe('You have been assigned room E-E-306, seat A2 for "Cyber quiz 1 — Exam" on 2026-09-22.');
  });

  it('renders INCIDENT_STATUS_UPDATED with the generic status wording when there is no specific message', () => {
    const msg = renderMessage('INCIDENT_STATUS_UPDATED', { status: 'RESOLVED' });
    expect(msg.title).toBe('Incident update');
    expect(msg.body).toContain('RESOLVED');
  });

  it('INCIDENT_STATUS_UPDATED prefers the specific title and sentence written for admins', () => {
    const msg = renderMessage('INCIDENT_STATUS_UPDATED', {
      status: 'OPEN',
      title: 'New incident reported',
      message: 'Suspected cheating (high severity) was reported during “Cyber quiz 1 — Exam”.',
    });
    expect(msg.title).toBe('New incident reported');
    expect(msg.body).toBe('Suspected cheating (high severity) was reported during “Cyber quiz 1 — Exam”.');
  });

  it('renders REPORT_READY with a readable report name and the exam it is for', () => {
    const msg = renderMessage('REPORT_READY', { report_label: 'Incident Report', session_name: 'Cyber quiz 1 — Exam' });
    expect(msg.title).toBe('Report ready');
    expect(msg.body).toBe('Your Incident Report for "Cyber quiz 1 — Exam" is ready to download.');
  });

  it('REPORT_READY still works for older payloads that only have the raw report type', () => {
    const msg = renderMessage('REPORT_READY', { report_type: 'ATTENDANCE' });
    expect(msg.body).toContain('ATTENDANCE');
  });

  it('tolerates missing payload fields rather than throwing', () => {
    expect(() => renderMessage('QUIZ_APPROVED', {})).not.toThrow();
  });

  it('renders the three suspension events for admin and faculty', () => {
    expect(renderMessage('SUSPENSION_REQUESTED', { faculty_name: 'Dr. Smith', session_name: 'Finals', reason: 'Venue flooded' })).toEqual({
      title: 'Suspension requested',
      body: 'Dr. Smith asked to suspend "Finals". Reason: Venue flooded',
    });
    const approved = renderMessage('SUSPENSION_APPROVED', { session_name: 'Finals', note: 'Rebook in November' });
    expect(approved.title).toBe('Suspension approved');
    expect(approved.body).toContain('"Finals" was approved');
    expect(approved.body).toContain('Note: Rebook in November');
    expect(renderMessage('SUSPENSION_REJECTED', { session_name: 'Finals', note: 'Exam must go ahead' })).toEqual({
      title: 'Suspension declined',
      body: 'Your request to suspend "Finals" was declined. Reason: Exam must go ahead',
    });
  });

  it('renders invigilator duty notifications: assigned, removed, and cancelled-with-session', () => {
    expect(
      renderMessage('INVIGILATOR_ASSIGNED', {
        session_name: 'Finals',
        room_label: 'B-107',
        session_date: '2027-02-01',
        start_time: '09:00',
        end_time: '10:00',
        role: 'LEAD_INVIGILATOR',
      }),
    ).toEqual({
      title: 'Invigilator duty assigned',
      body: 'You have been assigned as lead invigilator for "Finals" in room B-107 on 2027-02-01 at 09:00-10:00.',
    });
    expect(renderMessage('INVIGILATOR_REMOVED', { session_name: 'Finals', room_label: 'B-107', cause: 'REMOVED' })).toEqual({
      title: 'Invigilator duty removed',
      body: 'You are no longer assigned to invigilate "Finals" in room B-107.',
    });
    expect(
      renderMessage('INVIGILATOR_REMOVED', { session_name: 'Finals', room_label: 'B-107', cause: 'SESSION_CANCELLED', reason: 'Venue unavailable' }),
    ).toEqual({
      title: 'Invigilator duty cancelled',
      body: '"Finals" was cancelled, so your invigilator duty in room B-107 is cancelled. Reason: Venue unavailable',
    });
  });

  it('renders EXAM_SESSION_RESCHEDULED for an invigilator with their room', () => {
    expect(
      renderMessage('EXAM_SESSION_RESCHEDULED', {
        session_name: 'Finals',
        session_date: '2027-02-01',
        start_time: '10:00',
        end_time: '12:00',
        as_invigilator: true,
        room_label: 'B-107',
      }),
    ).toEqual({
      title: 'Invigilation rescheduled',
      body: '"Finals", which you invigilate in room B-107, has been rescheduled to 2027-02-01 10:00-12:00.',
    });
  });
});
