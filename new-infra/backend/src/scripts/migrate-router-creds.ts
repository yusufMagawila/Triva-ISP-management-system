/**
 * One-off migration: encrypt existing plaintext router credentials.
 *
 * Prerequisites:
 * - ROUTER_CREDENTIALS_KEY and TENANT_KEYS_ENCRYPTION_KEY are set.
 * - Prisma schema has been updated with passwordEnc / keysEnc columns.
 * - A fresh database backup exists.
 *
 * Run in the target environment after restoring data and before starting the app:
 *   npx tsx src/scripts/migrate-router-creds.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  encryptRouterCredential,
  encryptTenantKey,
} from '../lib/crypto';

const prisma = new PrismaClient();

async function main() {
  let migratedRouters = 0;
  let migratedTpLink = 0;
  let migratedOmada = 0;
  let migratedTenants = 0;

  // MikroTik routers
  const routers = await prisma.router.findMany({
    where: { passwordEnc: null },
    select: { id: true, passwordHash: true },
  });
  for (const router of routers) {
    if (!router.passwordHash) continue;
    await prisma.router.update({
      where: { id: router.id },
      data: { passwordEnc: encryptRouterCredential(router.passwordHash) },
    });
    migratedRouters += 1;
  }

  // TP-Link routers
  const tplinkRouters = await prisma.tpLinkRouter.findMany({
    where: { passwordEnc: null },
    select: { id: true, passwordHash: true },
  });
  for (const router of tplinkRouters) {
    if (!router.passwordHash) continue;
    await prisma.tpLinkRouter.update({
      where: { id: router.id },
      data: { passwordEnc: encryptRouterCredential(router.passwordHash) },
    });
    migratedTpLink += 1;
  }

  // Omada sites
  const omadaSites = await prisma.omadaSite.findMany({
    where: { radiusSecretEnc: null },
    select: { id: true, radiusSecret: true },
  });
  for (const site of omadaSites) {
    if (!site.radiusSecret) continue;
    await prisma.omadaSite.update({
      where: { id: site.id },
      data: { radiusSecretEnc: encryptRouterCredential(site.radiusSecret) },
    });
    migratedOmada += 1;
  }

  // Tenant payment keys
  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { mongikApiKeyEnc: null, mongikApiKey: { not: null } },
        { anypayApiKeyEnc: null, anypayApiKey: { not: null } },
        { zenopayApiKeyEnc: null, zenopayApiKey: { not: null } },
      ],
    },
    select: {
      id: true,
      mongikApiKey: true,
      anypayApiKey: true,
      zenopayApiKey: true,
    },
  });
  for (const tenant of tenants) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        mongikApiKeyEnc: tenant.mongikApiKey
          ? encryptTenantKey(tenant.mongikApiKey)
          : null,
        anypayApiKeyEnc: tenant.anypayApiKey
          ? encryptTenantKey(tenant.anypayApiKey)
          : null,
        zenopayApiKeyEnc: tenant.zenopayApiKey
          ? encryptTenantKey(tenant.zenopayApiKey)
          : null,
      },
    });
    migratedTenants += 1;
  }

  console.log(
    `Migration complete: routers=${migratedRouters}, tplink=${migratedTpLink}, omada=${migratedOmada}, tenants=${migratedTenants}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
