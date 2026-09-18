/**
 * Phase 23 load-test seed script.
 *
 * Seeds a moderate volume of academic-structure data tagged with the
 * `LOAD_TEST_` code prefix so list/pagination endpoints (/departments,
 * /subjects) have realistic volume to query against, instead of the sparse
 * real demo data. Everything this script creates is deleted by
 * `cleanup-load-test-data.ts`.
 *
 * Run: npx ts-node load-tests/seed-load-test-data.ts
 * (from apps/api/)
 */
import { PrismaClient } from '@exam-sync/db';

const prisma = new PrismaClient();

const N_DEPARTMENTS = 5;
const N_SUBJECTS_PER_DEPT = 100; // -> 500 subjects total, realistic list-page volume

async function main() {
  const depts = [];
  for (let i = 0; i < N_DEPARTMENTS; i++) {
    const d = await prisma.department.create({
      data: {
        name: `LOAD_TEST_Department_${i}`,
        code: `LOAD_TEST_DEPT_${i}`,
        status: 'ACTIVE',
      },
    });
    depts.push(d);
  }

  let created = 0;
  for (const d of depts) {
    const rows = Array.from({ length: N_SUBJECTS_PER_DEPT }).map((_, j) => ({
      departmentId: d.id,
      code: `LOAD_TEST_SUB_${d.code}_${j}`,
      name: `LOAD_TEST Subject ${d.code} ${j}`,
      credits: 3,
      isActive: true,
    }));
    const res = await prisma.subject.createMany({ data: rows });
    created += res.count;
  }

  console.log(`Seeded ${depts.length} departments, ${created} subjects (prefix LOAD_TEST_).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
