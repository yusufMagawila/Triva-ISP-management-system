/**
 * One-off: create a SUPER_ADMIN account (no demo data).
 *
 * Run inside the backend container (credentials come from the environment so
 * they never land in the repo, shell history of the repo, or logs):
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-unique-password' node dist/scripts/create-admin.js
 *
 * Refuses to touch an existing non-admin account and never prints the password.
 */

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Platform Admin';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('ADMIN_EMAIL is required and must be a valid email');
  if (!password || password.length < 12) throw new Error('ADMIN_PASSWORD is required and must be at least 12 characters');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== 'SUPER_ADMIN') {
    throw new Error(`${email} already exists as ${existing.role}; refusing to change it`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, passwordHash, name, role: 'SUPER_ADMIN' },
  });

  console.log(`SUPER_ADMIN ready: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error('create-admin failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
