import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!_prisma) {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to create PrismaClient: DATABASE_URL must include _test.');
    }
    _prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  }
  return _prisma;
}

export async function cleanDatabase(): Promise<void> {
  const prisma = getTestPrisma();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      payments, sessions, vouchers, subscriptions, radius_users, omada_portal_tokens,
      plans, routers, tplink_routers, omada_sites, nas, users, tenants
    RESTART IDENTITY CASCADE;
  `);
}
