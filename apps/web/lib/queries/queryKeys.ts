/**
 * Central query-key factory. Keep every resource's keys here as the app
 * grows (M3+) so invalidation stays consistent — don't inline ad hoc key
 * arrays at call sites.
 */
export const queryKeys = {
  currentUser: () => ['auth', 'me'] as const,
  quizzes: (params?: Record<string, string | undefined>) => ['quizzes', 'list', params ?? {}] as const,
  quiz: (id: string) => ['quizzes', 'detail', id] as const,
  quizApprovalHistory: (id: string) => ['quizzes', 'approval-history', id] as const,
  quizRoomSuggestions: (id: string) => ['quizzes', id, 'rooms', 'suggest'] as const,
  quizRoomConflicts: (id: string) => ['quizzes', id, 'rooms', 'conflicts'] as const,
  eligibleStudentCount: (params: Record<string, string | undefined>) => ['quizzes', 'eligible-student-count', params] as const,
  incidents: (params?: Record<string, string | undefined>) => ['incidents', 'list', params ?? {}] as const,
  incident: (id: string) => ['incidents', 'detail', id] as const,
  incidentHistory: (id: string) => ['incidents', 'history', id] as const,
  notifications: (params?: Record<string, string | undefined>) =>
    ['notifications', 'list', params ?? {}] as const,
  reportJob: (id: string) => ['report-jobs', 'detail', id] as const,
  auditLogs: (params?: Record<string, string | undefined>) => ['audit-logs', 'list', params ?? {}] as const,

  departments: (params?: Record<string, string | undefined>) => ['departments', 'list', params ?? {}] as const,
  programs: (params?: Record<string, string | undefined>) => ['programs', 'list', params ?? {}] as const,
  batches: (params?: Record<string, string | undefined>) => ['batches', 'list', params ?? {}] as const,
  subjects: (params?: Record<string, string | undefined>) => ['subjects', 'list', params ?? {}] as const,
  students: (params?: Record<string, string | undefined>) => ['students', 'list', params ?? {}] as const,
  faculty: (params?: Record<string, string | undefined>) => ['faculty', 'list', params ?? {}] as const,
  importJob: (id: string) => ['import-jobs', id] as const,

  examSessions: (params?: Record<string, string | undefined>) => ['exam-sessions', 'list', params ?? {}] as const,
  examSession: (id: string) => ['exam-sessions', 'detail', id] as const,
  suspensionRequests: (params?: Record<string, string | undefined>) => ['suspension-requests', 'list', params ?? {}] as const,
  examSessionConflicts: (id: string) => ['exam-sessions', 'conflicts', id] as const,
  examSessionRoster: (id: string, params?: Record<string, string | undefined>) =>
    ['exam-sessions', 'roster', id, params ?? {}] as const,

  rooms: (params?: Record<string, string | undefined>) => ['rooms', 'list', params ?? {}] as const,
  room: (id: string) => ['rooms', 'detail', id] as const,
  availableRooms: (params?: Record<string, string | undefined>) => ['rooms', 'available', params ?? {}] as const,
  roomSuggestions: (examSessionId: string) => ['exam-sessions', examSessionId, 'rooms', 'suggest'] as const,
  roomAvailabilityPreview: (examSessionId: string) => ['exam-sessions', examSessionId, 'rooms', 'preview'] as const,
  roomsAvailabilityCalendar: (params?: Record<string, string | undefined>) =>
    ['rooms', 'availability-calendar', params ?? {}] as const,
  roomSeats: (roomId: string) => ['rooms', 'seats', roomId] as const,
  roomAvailabilityBlocks: (roomId: string, params?: Record<string, string | undefined>) =>
    ['rooms', 'availability-blocks', roomId, params ?? {}] as const,

  facultyAssignments: (facultyId: string, params?: Record<string, string | undefined>) =>
    ['faculty-assignments', 'list', facultyId, params ?? {}] as const,

  seatingPlan: (id: string) => ['seating-plans', 'detail', id] as const,
  currentSeatingPlan: (sessionId: string, roomId: string) => ['seating-plans', 'current', sessionId, roomId] as const,
  seatingJob: (id: string) => ['seating-jobs', 'detail', id] as const,

  invigilationDuties: (facultyId: string, params?: Record<string, string | undefined>) =>
    ['faculty', 'invigilation-duties', facultyId, params ?? {}] as const,
  sessionInvigilators: (examSessionId: string, params?: Record<string, string | undefined>) =>
    ['exam-sessions', 'invigilators', examSessionId, params ?? {}] as const,
  sessionAttendance: (examSessionId: string, params?: Record<string, string | undefined>) =>
    ['exam-sessions', 'attendance', examSessionId, params ?? {}] as const,
  studentAttendanceHistory: (studentId: string, params?: Record<string, string | undefined>) =>
    ['students', 'attendance-history', studentId, params ?? {}] as const,
};
