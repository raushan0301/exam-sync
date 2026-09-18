/**
 * Development seed data — one user per role so every role can be tested
 * independently. Must never run against a production database (passwords
 * below are intentionally insecure / local-dev-only).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ROLES = ['ADMIN', 'FACULTY', 'STUDENT', 'INVIGILATOR'] as const;

const PERMISSIONS = [
  'user:read_self',
  'user:read_any',
  'user:assign_role',
];

const ADMIN_PERMISSIONS = ['user:read_any', 'user:assign_role'];

// One dev user per role — email / plaintext password (hashed before insert)
const DEV_USERS: { email: string; password: string; role: (typeof ROLES)[number] }[] = [
  { email: 'admin@dev.local',       password: 'Admin@123',       role: 'ADMIN'       },
  { email: 'faculty@dev.local',     password: 'Faculty@123',     role: 'FACULTY'     },
  { email: 'student@dev.local',     password: 'Student@123',     role: 'STUDENT'     },
  { email: 'invigilator@dev.local', password: 'Invigilator@123', role: 'INVIGILATOR' },
];

async function main() {
  // ── 1. Roles ──────────────────────────────────────────────────────────────
  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
  }
  console.log('✅ Roles seeded:', ROLES.join(', '));

  // ── 2. Permissions ────────────────────────────────────────────────────────
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, create: { code }, update: {} });
  }
  console.log('✅ Permissions seeded:', PERMISSIONS.join(', '));

  // ── 3. ADMIN role → permissions ───────────────────────────────────────────
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  for (const code of ADMIN_PERMISSIONS) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      create: { roleId: adminRole.id, permissionId: permission.id },
      update: {},
    });
  }
  console.log('✅ Admin permissions linked');

  // ── 4. Skip user creation in production ───────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    console.log('NODE_ENV=production — skipping dev user creation.');
    return;
  }

  // ── 5. One user per role ──────────────────────────────────────────────────
  console.log('\n📋 Dev credentials:\n' + '─'.repeat(55));
  console.log('  Role         Email                       Password');
  console.log('─'.repeat(55));

  for (const { email, password, role } of DEV_USERS) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await prisma.user.upsert({
      where:  { email },
      create: { email, passwordHash, isActive: true },
      update: {},
    });

    const roleRecord = await prisma.role.findUniqueOrThrow({ where: { name: role } });

    await prisma.userRole.upsert({
      where:  { userId_roleId: { userId: user.id, roleId: roleRecord.id } },
      create: { userId: user.id, roleId: roleRecord.id },
      update: {},
    });

    console.log(`  ${role.padEnd(12)} ${email.padEnd(28)} ${password}`);
  }

  console.log('─'.repeat(55));
  console.log('\n✅ All dev users seeded successfully!\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
