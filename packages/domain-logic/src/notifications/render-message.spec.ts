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

  it('renders INCIDENT_STATUS_UPDATED', () => {
    const msg = renderMessage('INCIDENT_STATUS_UPDATED', { status: 'RESOLVED' });
    expect(msg.body).toContain('RESOLVED');
  });

  it('renders REPORT_READY', () => {
    const msg = renderMessage('REPORT_READY', { report_type: 'ATTENDANCE' });
    expect(msg.title).toBe('Report ready');
    expect(msg.body).toContain('ATTENDANCE');
  });

  it('tolerates missing payload fields rather than throwing', () => {
    expect(() => renderMessage('QUIZ_APPROVED', {})).not.toThrow();
  });
});
