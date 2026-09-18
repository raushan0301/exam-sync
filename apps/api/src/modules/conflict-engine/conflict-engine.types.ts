export interface ConflictDetail {
  type:
    | 'UNAPPROVED_QUIZ'
    | 'QUIZ_ALREADY_ATTACHED_ELSEWHERE'
    | 'STUDENT_OVERLAP'
    | 'ROOM_OVERLAP'
    | 'ROOM_UNAVAILABLE'
    | 'FACULTY_OVERLAP';
  quizId?: string;
  /** Set for STUDENT_OVERLAP (BR-019) — the student with the conflicting assignment. */
  studentId?: string;
  /** Set for ROOM_OVERLAP/ROOM_UNAVAILABLE (BR-018/BR-022) — the candidate room this conflict is about. */
  roomId?: string;
  /** Set for FACULTY_OVERLAP (BR-020/BR-031) — the faculty member with the conflicting invigilation assignment. */
  facultyId?: string;
  /** Set for STUDENT_OVERLAP/ROOM_OVERLAP/FACULTY_OVERLAP — the other exam session already holding the conflicting claim. */
  conflictingExamSessionId?: string;
  message: string;
}

export interface ConflictCheckResult {
  hard: ConflictDetail[];
  warnings: ConflictDetail[];
}

export interface SessionAssemblyCheckInput {
  examSessionId: string;
  /** Quiz ids being considered for attachment (already known-existing, BR-017/BR-053 checked separately by the caller). */
  quizIds: string[];
  sessionDate: Date;
  startTime: Date;
  endTime: Date;
}

/** Input for `checkRoomAllocation` (Phase 12, BR-018/BR-022) — distinct shape from session assembly since candidates are rooms, not quizzes. */
export interface RoomAllocationCheckInput {
  examSessionId: string;
  roomIds: string[];
  sessionDate: Date;
  startTime: Date;
  endTime: Date;
}

/** Input for `checkInvigilatorAssignment` (Phase 16, BR-020/BR-031) — a single faculty being assigned to a single room within a session. */
export interface InvigilatorAssignmentCheckInput {
  facultyId: string;
  examSessionId: string;
  roomId: string;
  sessionDate: Date;
  startTime: Date;
  endTime: Date;
}
