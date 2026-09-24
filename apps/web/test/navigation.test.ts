import { describe, expect, it } from 'vitest';
import { isPathAllowedForRole, dashboardPathForRole, ADMIN_NAV, FACULTY_NAV, STUDENT_NAV, isNavGroup } from '@/lib/navigation';

describe('isPathAllowedForRole (pure path-prefix -> role map)', () => {
  it('allows an admin path for ADMIN', () => {
    expect(isPathAllowedForRole('/admin/academic-structure/departments', 'ADMIN')).toBe(true);
  });

  it('rejects an admin path for STUDENT', () => {
    expect(isPathAllowedForRole('/admin/dashboard', 'STUDENT')).toBe(false);
  });

  it('allows INVIGILATOR under /faculty', () => {
    expect(isPathAllowedForRole('/faculty/dashboard', 'INVIGILATOR')).toBe(true);
  });

  it('rejects when role is null', () => {
    expect(isPathAllowedForRole('/admin/dashboard', null)).toBe(false);
  });

  it('rejects an unknown prefix', () => {
    expect(isPathAllowedForRole('/unknown/path', 'ADMIN')).toBe(false);
  });
});

describe('dashboardPathForRole', () => {
  it('maps each role to its dashboard', () => {
    expect(dashboardPathForRole('ADMIN')).toBe('/admin/dashboard');
    expect(dashboardPathForRole('FACULTY')).toBe('/faculty/dashboard');
    expect(dashboardPathForRole('INVIGILATOR')).toBe('/faculty/dashboard');
    expect(dashboardPathForRole('STUDENT')).toBe('/student/dashboard');
    expect(dashboardPathForRole(null)).toBe('/login');
  });
});

describe('nav config data shape', () => {
  it('ADMIN nav has the Academic Structure group with 4 real links', () => {
    const group = ADMIN_NAV.find((e) => isNavGroup(e) && e.label === 'Academic Structure');
    expect(group).toBeTruthy();
    if (group && isNavGroup(group)) {
      expect(group.items).toHaveLength(4);
      expect(group.items.every((i) => !!i.href)).toBe(true);
    }
  });

  it('ADMIN nav includes a Notifications item with an href', () => {
    const item = ADMIN_NAV.find((e) => !isNavGroup(e) && e.label === 'Notifications');
    expect(item).toBeTruthy();
    expect((item as { href?: string }).href).toBe('/admin/notifications');
  });

  it('FACULTY nav has 7 top-level entries including Dashboard and Notifications', () => {
    expect(FACULTY_NAV.some((e) => e.label === 'Dashboard')).toBe(true);
    expect(FACULTY_NAV.some((e) => e.label === 'Notifications')).toBe(true);
    expect(FACULTY_NAV).toHaveLength(7);
  });

  it('STUDENT nav has exactly 4 entries', () => {
    expect(STUDENT_NAV).toHaveLength(4);
    expect(STUDENT_NAV.map((e) => e.label)).toEqual(['Dashboard', 'My Schedule', 'Notifications', 'Attendance History']);
  });

  it('items without a real page have no href (disabled-label convention)', () => {
    const invigilation = ADMIN_NAV.find((e) => e.label === 'Invigilation');
    expect(invigilation && !isNavGroup(invigilation) ? invigilation.href : undefined).toBeUndefined();
  });

  it('ADMIN nav Rooms links to the real Rooms management page (Milestone 7)', () => {
    const rooms = ADMIN_NAV.find((e) => e.label === 'Rooms');
    expect(rooms && !isNavGroup(rooms) ? rooms.href : undefined).toBe('/admin/rooms');
  });

  it('ADMIN nav Faculty Assignments links to the real page (Milestone 7)', () => {
    const people = ADMIN_NAV.find((e) => e.label === 'People');
    const faItem =
      people && isNavGroup(people) ? people.items.find((i) => i.label === 'Faculty Assignments') : undefined;
    expect(faItem?.href).toBe('/admin/people/faculty-assignments');
  });

  it('ADMIN nav Exam Sessions links to the read-only list page (faculty-lifecycle-ownership change: admin can no longer create sessions)', () => {
    const examSessions = ADMIN_NAV.find((e) => e.label === 'Exam Sessions');
    expect(examSessions && !isNavGroup(examSessions) ? examSessions.href : undefined).toBe('/admin/exam-sessions');
  });

  it('FACULTY nav Exam Sessions links to the real "My Exam Sessions" list page (faculty-lifecycle-ownership change)', () => {
    const examSessions = FACULTY_NAV.find((e) => e.label === 'Exam Sessions');
    expect(examSessions && !isNavGroup(examSessions) ? examSessions.href : undefined).toBe('/faculty/exam-sessions');
  });
});
