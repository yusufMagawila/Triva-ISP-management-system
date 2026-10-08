/**
 * Device registry — single implementation of asset creation shared by the
 * merchant dashboard controllers and the installation action executor.
 * New code paths must call these functions rather than duplicating them.
 */

import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { getPlanConfig } from '../config/plans';
import { encryptRouterCredential, decryptRouterCredential } from '../lib/crypto';
import {
  allocateNextRouterControlIp,
  generateProvisioningKey,
  generateRouterApiPassword,
  generateRouterApiUsername,
  normalizeRouterMac,
  normalizeRouterSerial,
} from './router-provisioning.service';
import {
  generateTpLinkProvisioningKey,
  generateTpLinkSshPassword,
  generateTpLinkSshUsername,
} from './tplink-provisioning.service';

export class PlanLimitError extends Error {
  statusCode = 403;
  limitReached = true;
  currentPlan?: string;
  constructor(message: string, plan?: string) {
    super(message);
    this.currentPlan = plan;
  }
}

async function assertRouterQuota(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      subscription: true,
      _count: { select: { routers: true, tplinkRouters: true, omadaSites: true } },
    },
  });
  const planConfig = getPlanConfig(tenant?.subscription?.plan);
  const total =
    (tenant?._count.routers ?? 0) +
    (tenant?._count.tplinkRouters ?? 0) +
    (tenant?._count.omadaSites ?? 0);
  if (planConfig.maxRouters !== -1 && total >= planConfig.maxRouters) {
    throw new PlanLimitError(
      `Your ${planConfig.label} plan allows a maximum of ${planConfig.maxRouters} site device(s). Upgrade your subscription to add more.`,
      tenant?.subscription?.plan
    );
  }
}

export interface MikrotikAssetParams {
  name: string;
  serialNumber?: string;
  hardwareMac?: string;
  hotspotName?: string;
  location?: string;
  siteId?: string;
}

/**
 * Create a MikroTik router asset. The API password is generated server-side,
 * stored ONLY in `passwordEnc` (AES-256-GCM); `passwordHash` stays empty —
 * legacy plaintext storage is retired for new assets.
 */
export async function createMikrotikAsset(tenantId: string, params: MikrotikAssetParams) {
  await assertRouterQuota(tenantId);

  const router = await prisma.router.create({
    data: {
      tenantId,
      name: params.name,
      ipAddress: await allocateNextRouterControlIp(),
      apiPort: 8728,
      username: generateRouterApiUsername(),
      passwordHash: '',
      passwordEnc: encryptRouterCredential(generateRouterApiPassword()),
      provisioningKey: generateProvisioningKey(),
      serialNumber: normalizeRouterSerial(params.serialNumber) ?? null,
      hardwareMac: normalizeRouterMac(params.hardwareMac) ?? null,
      hotspotName: params.hotspotName ?? 'hotspot1',
      location: params.location ?? null,
      siteId: params.siteId ?? null,
      status: 'OFFLINE',
    },
  });

  logger.info('Router asset created', { routerId: router.id, tenantId });
  return router;
}

export interface TpLinkAssetParams {
  name: string;
  serialNumber?: string;
  hardwareMac?: string;
  openwrtVersion?: string;
  location?: string;
  siteId?: string;
}

export async function createTpLinkAsset(tenantId: string, params: TpLinkAssetParams) {
  await assertRouterQuota(tenantId);

  const router = await prisma.tpLinkRouter.create({
    data: {
      tenantId,
      name: params.name,
      ipAddress: await allocateNextRouterControlIp(),
      sshPort: 22,
      username: generateTpLinkSshUsername(),
      passwordHash: '',
      passwordEnc: encryptRouterCredential(generateTpLinkSshPassword()),
      provisioningKey: generateTpLinkProvisioningKey(),
      serialNumber: normalizeRouterSerial(params.serialNumber) ?? null,
      hardwareMac: normalizeRouterMac(params.hardwareMac) ?? null,
      openwrtVersion: params.openwrtVersion ?? null,
      location: params.location ?? null,
      siteId: params.siteId ?? null,
      status: 'OFFLINE',
    },
  });

  logger.info('TP-Link router asset created', { routerId: router.id, tenantId });
  return router;
}

// ─── Omada site assets ───────────────────────────────────────────────────────

export function generateRadiusSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Upsert a NAS client in the FreeRADIUS nas table for this Omada site.
 * Controller IP absent → wildcard '%' (any source IP can authenticate with
 * the shared secret).
 */
export async function upsertNasClient(
  siteId: string,
  controllerIp: string | null | undefined,
  radiusSecretEnc: string | null,
  siteName: string
): Promise<void> {
  const radiusSecret = radiusSecretEnc ? decryptRouterCredential(radiusSecretEnc) : '';
  if (!radiusSecret) return;
  const nasname = controllerIp || '%';
  await prisma.$executeRaw`
    INSERT INTO nas (nasname, shortname, type, secret, description)
    VALUES (${nasname}, ${'omada-' + siteName}, 'other', ${radiusSecret}, ${'Omada site: ' + siteName + ' (' + siteId + ')'})
    ON CONFLICT (nasname) DO UPDATE SET
      secret = EXCLUDED.secret,
      shortname = EXCLUDED.shortname,
      description = EXCLUDED.description
  `;
}

export async function removeNasClient(controllerIp: string | null | undefined, siteId: string): Promise<void> {
  const nasname = controllerIp || '%';
  await prisma.$executeRaw`
    DELETE FROM nas WHERE nasname = ${nasname} AND description LIKE ${'%' + siteId + '%'}
  `;
}

export interface OmadaSiteAssetParams {
  name: string;
  controllerUrl?: string;
  controllerIp?: string;
  ssidName?: string;
  hotspotName?: string;
  location?: string;
  siteId?: string;
}

/**
 * Create an Omada site asset. The RADIUS shared secret is generated
 * server-side and stored ONLY encrypted (`radiusSecretEnc`); the legacy
 * plaintext `radiusSecret` column stays empty for new sites.
 */
export async function createOmadaSiteAsset(tenantId: string, params: OmadaSiteAssetParams) {
  await assertRouterQuota(tenantId);

  const site = await prisma.omadaSite.create({
    data: {
      tenantId,
      name: params.name,
      controllerUrl: params.controllerUrl ?? null,
      controllerIp: params.controllerIp ?? null,
      radiusSecret: '',
      radiusSecretEnc: encryptRouterCredential(generateRadiusSecret()),
      ssidName: params.ssidName ?? null,
      hotspotName: params.hotspotName ?? 'omada1',
      location: params.location ?? null,
      siteId: params.siteId ?? null,
      status: 'OFFLINE',
    },
  });

  await upsertNasClient(site.id, site.controllerIp, site.radiusSecretEnc, site.name).catch((err) => {
    logger.warn('Failed to register NAS client', { siteId: site.id, err });
  });

  logger.info('Omada site asset created', { siteId: site.id, tenantId });
  return site;
}
