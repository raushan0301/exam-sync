/**
 * Phase 23 load-test cleanup script.
 *
 * Deletes everything created by seed-load-test-data.ts (code prefix
 * LOAD_TEST_) and prints a verification count that must be zero, plus a
 * count of the real demo rows to confirm they are untouched.
 *
 * Run: npx ts-node load-tests/cleanup-load-test-data.ts
 */
import { PrismaClient } from '@exam-sync/db';

const prisma = new PrismaClient();

async function main() {
  const delSubjects = await prisma.subject.deleteMany({
    where: { code: { startsWith: 'LOAD_TEST_' } },
  });
  const delDepts = await prisma.department.deleteMany({
    where: { code: { startsWith: 'LOAD_TEST_' } },
  });

  console.log(`Deleted ${delSubjects.count} subjects, ${delDepts.count} departments.`);

  const residueDepts = await prisma.department.count({ where: { code: { startsWith: 'LOAD_TEST_' } } });
  const residueSubjects = await prisma.subject.count({ where: { code: { startsWith: 'LOAD_TEST_' } } });

  console.log(`Residue check: departments=${residueDepts} subjects=${residueSubjects} (both must be 0)`);

  const realUserCount = await prisma.user.count();
  const realUsers = await prisma.user.findMany({ select: { email: true } });
  console.log(`Real user rows remaining: ${realUserCount} ->`, realUsers.map((u) => u.email));

  if (residueDepts !== 0 || residueSubjects !== 0) {
    console.error('RESIDUE DETECTED — cleanup incomplete.');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
