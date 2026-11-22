/**
 * Creates a single admin user: admin@dev.local / Admin@123
 * Run with: ts-node --compiler-options '{"module":"commonjs"}' prisma/create-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const EMAIL    = 'admin@dev.local';
const PASSWORD = 'Admin@123';
const ROLE     = 'ADMIN';

async function main() {
  // 1. Ensure ADMIN role exists
  await prisma.role.upsert({ where: { name: ROLE }, create: { name: ROLE }, update: {} });

  // 2. Create (or skip) the user
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where:  { email: EMAIL },
    create: { email: EMAIL, passwordHash, isActive: true },
    update: {},
  });

  // 3. Assign ADMIN role
  const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLE } });
  await prisma.userRole.upsert({
    where:  { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });

  console.log('\n✅ Admin user ready:\n');
  console.log(`   Email    : ${EMAIL}`);
  console.log(`   Password : ${PASSWORD}`);
  console.log(`   Role     : ${ROLE}`);
  console.log(`   User ID  : ${user.id}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

