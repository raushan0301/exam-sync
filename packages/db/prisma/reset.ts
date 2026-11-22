/**
 * Deletes all rows from every table in FK-safe order (children before parents).
 * Uses raw SQL TRUNCATE ... CASCADE to avoid FK ordering issues.
 * Safe to run in development. Never run against production.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TABLES = [
  // Deepest leaves first
  'exam_session_room_students',
  'seating_assignments',
  'seating_plans',
  'attendance_history',
  'attendance',
  'incident_history',
  'incidents',
  'room_holds',
  'exam_session_room_requests',
  'exam_session_suspension_requests',
  'exam_session_room_quizzes',
  'exam_session_rooms',
  'exam_session_quizzes',
  'exam_invigilators',
  'quiz_approval_history',
  'quiz_student_assignments',
  'quiz_batches',
  'report_jobs',
  'import_jobs',
  'exam_sessions',
  'quizzes',
  'student_subject_enrollment',
  'faculty_subject_batch_assignment',
  'room_availability',
  'room_seats',
  'notifications',
  'audit_logs',
  'user_nav_seen',
  'auth_audit_events',
  'refresh_tokens',
  // Domain identity
  'students',
  'faculty',
  // Academic structure
  'subjects',
  'batches',
  'programs',
  'departments',
  'rooms',
  // Auth / RBAC
  'user_roles',
  'role_permissions',
  'users',
  'roles',
  'permissions',
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('❌ Refusing to run reset in production!');
  }

  console.log('🗑️  Deleting all data (TRUNCATE CASCADE)...\n');

  // Single statement — CASCADE handles all FK deps in one shot
  const tableList = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  console.log('✅ All tables truncated:\n');
  TABLES.forEach((t) => console.log(`  • ${t}`));
  console.log('\n✅ All data deleted successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
