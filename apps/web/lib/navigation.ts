/**
 * One typed nav-tree config per role (§11), plus the path-prefix→allowed-
 * roles map shared by BOTH the layout route guards (#6) and the post-login
 * redirect logic (#8) so there is exactly one source of truth for "who can
 * go where."
 *
 * Judgment call — items with no real page yet: rendered as a disabled,
 * non-clickable label (not a dead link that 404s). This keeps the full nav
 * structure visible per FRONTEND_UX_ARCHITECTURE.md (so users can see what
 * exists in the product) without ever navigating them into a broken page.
 * See AppShell's nav renderer for the actual disabled treatment.
 */

export type PrimaryRole = 'ADMIN' | 'FACULTY' | 'STUDENT';

export interface NavLeaf {
  label: string;
  /** Present only for items with a real, already-built destination. */
  href?: string;
}

export interface NavGroup {
  label: string;
  items: NavLeaf[];
}

export type NavEntry = NavLeaf | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return Array.isArray((entry as NavGroup).items);
}

export const ADMIN_NAV: NavEntry[] = [
  { label: 'Dashboard', href: '/admin/dashboard' },
  {
    label: 'Academic Structure',
    items: [
      { label: 'Departments', href: '/admin/academic-structure/departments' },
      { label: 'Programs', href: '/admin/academic-structure/programs' },
      { label: 'Batches', href: '/admin/academic-structure/batches' },
      { label: 'Subjects', href: '/admin/academic-structure/subjects' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Students', href: '/admin/people/students' },
      { label: 'Faculty', href: '/admin/people/faculty' },
      { label: 'Enrollments' },
      { label: 'Faculty Assignments', href: '/admin/people/faculty-assignments' },
    ],
  },
  {
    label: 'Quizzes',
    items: [
      { label: 'All Quizzes', href: '/admin/quizzes' },
      { label: 'Approval Queue', href: '/admin/quizzes/approval-queue' },
    ],
  },
  { label: 'Exam Sessions', href: '/admin/exam-sessions/new' },
  { label: 'Rooms', href: '/admin/rooms' },
  { label: 'Invigilation' },
  { label: 'Attendance' },
  { label: 'Incidents', href: '/admin/incidents' },
  { label: 'Reports', href: '/admin/reports' },
  { label: 'Notifications', href: '/admin/notifications' },
  { label: 'Audit Log', href: '/admin/audit-log' },
  { label: 'System Health' },
];

export const FACULTY_NAV: NavEntry[] = [
  { label: 'Dashboard', href: '/faculty/dashboard' },
  { label: 'My Quizzes', href: '/faculty/quizzes' },
  { label: 'My Assignments' },
  { label: 'Exam Sessions' },
  { label: 'My Invigilation Duties', href: '/faculty/invigilation-duties' },
  { label: 'Attendance' },
  {
    label: 'Incidents',
    items: [
      { label: 'My Incidents', href: '/faculty/incidents' },
      { label: 'Report Incident', href: '/faculty/incidents/new' },
    ],
  },
  { label: 'Notifications', href: '/faculty/notifications' },
];

export const STUDENT_NAV: NavEntry[] = [
  { label: 'Dashboard', href: '/student/dashboard' },
  { label: 'My Schedule' },
  { label: 'Notifications', href: '/student/notifications' },
  { label: 'Attendance History' },
];

export const NAV_BY_ROLE: Record<PrimaryRole, NavEntry[]> = {
  ADMIN: ADMIN_NAV,
  FACULTY: FACULTY_NAV,
  STUDENT: STUDENT_NAV,
};

/**
 * Path-prefix → allowed-roles map. Reused by:
 *  - app/{admin,faculty,student}/layout.tsx RoleGate `allow` lists
 *  - login page's post-login redirect (`?redirect=` authorization check)
 * INVIGILATOR is folded into the Faculty experience per the architecture
 * doc, so it's allowed under /faculty alongside FACULTY.
 */
export const ROLE_PATH_PREFIXES: { prefix: string; roles: string[] }[] = [
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/faculty', roles: ['FACULTY', 'INVIGILATOR'] },
  { prefix: '/student', roles: ['STUDENT'] },
];

export function dashboardPathForRole(role: string | null): string {
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'FACULTY' || role === 'INVIGILATOR') return '/faculty/dashboard';
  if (role === 'STUDENT') return '/student/dashboard';
  return '/login';
}

/** Pure function (unit-tested): is `path` an authorized destination for `role`? */
export function isPathAllowedForRole(path: string, role: string | null): boolean {
  if (!role) return false;
  const match = ROLE_PATH_PREFIXES.find((p) => path.startsWith(p.prefix));
  if (!match) return false;
  return match.roles.includes(role);
}
