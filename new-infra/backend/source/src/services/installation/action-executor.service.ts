/**
 * Structured action executor — the ONLY path from an installation contract
 * to device changes.
 *
 * Closed vocabulary: every action type must exist in ACTION_REGISTRY.
 * Anything else (including "execute_shell" or arbitrary RouterOS strings) is
 * rejected as UNKNOWN_ACTION before any device call. Implemented actions
 * dispatch to existing typed services; known-but-unsupported actions return
 * NOT_IMPLEMENTED rather than pretending.
 *
 * The executor never accepts raw commands, never logs secrets, and audits
 * every request/result.
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { createMikroTikService } from '../mikrotik.service';
import { createTpLinkService } from '../tplink.service';
import {
  createMikrotikAsset,
  createTpLinkAsset,
  createOmadaSiteAsset,
} from '../device-registry.service';
import {
  normalizeRouterMac,
  normalizeRouterSerial,
  buildRouterBootstrapUrls,
} from '../router-provisioning.service';
import { matchIdentity } from './identity.service';
import { gateAction, type ActionPolicyContext } from './policy-validator.service';
import { recordAudit } from '../audit.service';
import { sanitizeSecrets } from '../../lib/sanitize';
import { actionRequestSchema, type ActionResult } from '../../lib/installation-contract';

// ─── Params schemas ──────────────────────────────────────────────────────────

const pAssetId = z.string().min(1).max(64);
const pMac = z.string().regex(/^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$/);
const pSerial = z.string().trim().min(4).max(64);

const registerRouterParams = z.object({
  name: z.string().trim().min(1).max(100),
  serialNumber: pSerial.optional(),
  hardwareMac: pMac.optional(),
  hotspotName: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
}).strict();

const registerTpLinkParams = registerRouterParams.extend({
  openwrtVersion: z.string().trim().max(64).optional(),
}).strict();

const registerOmadaSiteParams = z.object({
  name: z.string().trim().min(1).max(100),
  controllerUrl: z.string().trim().url().max(200).optional(),
  controllerIp: z.string().trim().regex(/^(\d{1,3}\.){3}\d{1,3}$/).optional(),
  ssidName: z.string().trim().max(32).optional(),
  hotspotName: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
}).strict();

const claimDeviceParams = z.object({
  vendor: z.enum(['MIKROTIK', 'TPLINK', 'OMADA']),
  assetId: pAssetId,
  serialNumber: pSerial.optional(),
  hardwareMac: pMac.optional(),
}).strict();

const assetParams = z.object({ assetId: pAssetId }).strict();

const hotspotProfileParams = z.object({
  assetId: pAssetId,
  profileName: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  downloadKbps: z.number().int().positive().max(1_000_000).optional(),
  uploadKbps: z.number().int().positive().max(1_000_000).optional(),
}).strict();

// ─── Executor context ────────────────────────────────────────────────────────

export interface ExecutorContext {
  actor: { userId: string; role: string; tenantId: string };
  tokenScope?: { installationId?: string | null; siteId?: string | null };
  correlationId?: string;
}

interface ActionDef {
  type: string;
  implemented: boolean;
  paramsSchema?: z.ZodTypeAny;
  requiresApproval?: boolean;
  allowedRoles?: string[];
  run?: (params: Record<string, unknown>, ctx: RunContext) => Promise<unknown>;
}

interface RunContext extends ExecutorContext {
  installation: { id: string; tenantId: string; siteId: string; installerId: string; status: string };
  /** Resolve a device asset scoped to this installation's tenant+site. */
  getScopedRouter(assetId: string): Promise<Prisma.RouterGetPayload<Record<string, never>>>;
}

function forbidden(msg: string): never {
  const e = new Error(msg) as Error & { statusCode?: number };
  e.statusCode = 403;
  throw e;
}

// ─── Action registry (closed vocabulary) ─────────────────────────────────────

const ACTION_REGISTRY: ActionDef[] = [
  {
    type: 'REGISTER_ROUTER',
    implemented: true,
    paramsSchema: registerRouterParams,
    run: async (p, ctx) => {
      const router = await createMikrotikAsset(ctx.installation.tenantId, {
        name: p.name as string,
        serialNumber: p.serialNumber as string | undefined,
        hardwareMac: p.hardwareMac as string | undefined,
        hotspotName: p.hotspotName as string | undefined,
        siteId: ctx.installation.siteId,
      });
      return { routerId: router.id, controlPlaneIp: router.ipAddress, provisioningKeyBound: Boolean(router.provisioningKey) };
    },
  },
  {
    type: 'REGISTER_TPLINK_ROUTER',
    implemented: true,
    paramsSchema: registerTpLinkParams,
    run: async (p, ctx) => {
      const router = await createTpLinkAsset(ctx.installation.tenantId, {
        name: p.name as string,
        serialNumber: p.serialNumber as string | undefined,
        hardwareMac: p.hardwareMac as string | undefined,
        openwrtVersion: p.openwrtVersion as string | undefined,
        siteId: ctx.installation.siteId,
      });
      return { routerId: router.id, controlPlaneIp: router.ipAddress };
    },
  },
  {
    type: 'REGISTER_OMADA_SITE',
    implemented: true,
    paramsSchema: registerOmadaSiteParams,
    run: async (p, ctx) => {
      const site = await createOmadaSiteAsset(ctx.installation.tenantId, {
        name: p.name as string,
        controllerUrl: p.controllerUrl as string | undefined,
        controllerIp: p.controllerIp as string | undefined,
        ssidName: p.ssidName as string | undefined,
        hotspotName: p.hotspotName as string | undefined,
        siteId: ctx.installation.siteId,
      });
      // RADIUS secret is encrypted at rest; never returned.
      return { omadaSiteId: site.id, nasRegistered: true };
    },
  },
  {
    type: 'CLAIM_DEVICE',
    implemented: true,
    paramsSchema: claimDeviceParams,
    run: async (p, ctx) => {
      const vendor = p.vendor as 'MIKROTIK' | 'TPLINK' | 'OMADA';
      const assetId = p.assetId as string;
      const claim = { serialNumber: p.serialNumber as string | undefined, macAddress: p.hardwareMac as string | undefined };

      const asset = await findAsset(vendor, assetId);
      if (!asset) {
        await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_CLAIM_DENIED', targetType: vendor.toLowerCase(), targetId: assetId, result: 'DENIED', metadata: { reason: 'NOT_FOUND' } });
        forbidden('Device not found');
      }

      const outcome = matchIdentity(
        { id: asset.id, tenantId: asset.tenantId, serialNumber: asset.serialNumber, hardwareMac: asset.hardwareMac, siteId: asset.siteId },
        { serialNumber: claim.serialNumber, macAddress: claim.macAddress },
        { tenantId: ctx.installation.tenantId, siteId: ctx.installation.siteId }
      );

      if (outcome.match === 'ALREADY_OWNED') {
        await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_CLAIM_DENIED', targetType: vendor.toLowerCase(), targetId: assetId, result: 'DENIED', metadata: { reason: 'DEVICE_ALREADY_ASSIGNED' } });
        forbidden('DEVICE_ALREADY_ASSIGNED');
      }
      if (outcome.match === 'MISMATCH') {
        await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_CLAIM_DENIED', targetType: vendor.toLowerCase(), targetId: assetId, result: 'DENIED', metadata: { reason: 'DEVICE_IDENTITY_MISMATCH' } });
        forbidden('DEVICE_IDENTITY_MISMATCH');
      }
      if (outcome.match === 'UNMATCHED') {
        await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_CLAIM_DENIED', targetType: vendor.toLowerCase(), targetId: assetId, result: 'DENIED', metadata: { reason: 'NO_IDENTITY_EVIDENCE' } });
        forbidden('Claim does not match any discovered or bound device identity');
      }

      // Bind asset to this installation's site (first binding fills identity).
      await bindAssetToSite(vendor, assetId, ctx.installation.siteId, outcome.normalizedClaim);
      await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_CLAIMED', targetType: vendor.toLowerCase(), targetId: assetId, metadata: { match: outcome.match } });
      return { assetId, match: outcome.match, siteId: ctx.installation.siteId };
    },
  },
  {
    type: 'DISCOVER_ROUTER',
    implemented: true,
    paramsSchema: assetParams,
    run: async (p, ctx) => {
      const router = await ctx.getScopedRouter(p.assetId as string);
      const service = createMikroTikService(router);
      const snapshot = await service.getDiscoverySnapshot();
      await prisma.router.update({
        where: { id: router.id },
        data: {
          discovery: snapshot as object,
          discoveredAt: new Date(),
          ...(snapshot.model ? { model: snapshot.model } : {}),
          ...(snapshot.routerOsVersion ? { routerOsVersion: snapshot.routerOsVersion } : {}),
        },
      });
      await recordAudit({ ...auditBase(ctx, ctx.installation), action: 'DEVICE_DISCOVERED', targetType: 'router', targetId: router.id, metadata: { live: true, model: snapshot.model, routerOsVersion: snapshot.routerOsVersion } });
      return sanitizeSecrets(snapshot);
    },
  },
  {
    type: 'READ_ROUTER_IDENTITY',
    implemented: true,
    paramsSchema: assetParams,
    run: async (p, ctx) => {
      const router = await ctx.getScopedRouter(p.assetId as string);
      return {
        assetId: router.id,
        name: router.name,
        serialNumber: router.serialNumber,
        hardwareMac: router.hardwareMac,
        lastDiscovery: router.discovery ?? null,
      };
    },
  },
  {
    type: 'RUN_CONNECTIVITY_TEST',
    implemented: true,
    paramsSchema: z.object({ assetId: pAssetId, vendor: z.enum(['MIKROTIK', 'TPLINK']).default('MIKROTIK') }).strict(),
    run: async (p, ctx) => {
      const vendor = p.vendor as 'MIKROTIK' | 'TPLINK';
      if (vendor === 'TPLINK') {
        const t = await prisma.tpLinkRouter.findFirst({
          where: { id: p.assetId as string, tenantId: ctx.installation.tenantId, siteId: ctx.installation.siteId },
        });
        if (!t) forbidden('Device not in installation scope');
        const ok = await createTpLinkService(t).testConnection();
        return { reachable: ok };
      }
      const router = await ctx.getScopedRouter(p.assetId as string);
      const ok = await createMikroTikService(router).testConnection();
      return { reachable: ok };
    },
  },
  {
    type: 'CONFIGURE_HOTSPOT_PROFILE',
    implemented: true,
    paramsSchema: hotspotProfileParams,
    run: async (p, ctx) => {
      const router = await ctx.getScopedRouter(p.assetId as string);
      await createMikroTikService(router).createOrUpdateProfile(
        router.hotspotName,
        p.profileName as string,
        p.downloadKbps as number | undefined,
        p.uploadKbps as number | undefined
      );
      return { profileName: p.profileName, applied: true };
    },
  },
  {
    type: 'GENERATE_BOOTSTRAP',
    implemented: true,
    paramsSchema: assetParams,
    run: async (p, ctx) => {
      const router = await ctx.getScopedRouter(p.assetId as string);
      if (!router.provisioningKey) forbidden('Router has no provisioning key');
      const apiUrl = process.env.APP_URL ?? '';
      // URLs contain the provisioning key — a capability to pull a script,
      // not a stored credential. The script itself is generated at fetch time.
      return { bootstrapUrls: buildRouterBootstrapUrls(router, apiUrl) };
    },
  },
];

/** Known action names that exist in the vocabulary but are not yet wired. */
const DECLARED_NOT_IMPLEMENTED = [
  'CONFIGURE_WAN',
  'CONFIGURE_LAN',
  'CONFIGURE_DHCP',
  'CONFIGURE_FIREWALL',
  'CONFIGURE_HOTSPOT',
  'DISCOVER_ACCESS_POINT',
  'CONFIGURE_ACCESS_POINT',
  'CONFIGURE_OMADA_CONTROLLER',
  'RUN_PORTAL_TEST',
  'RUN_PAYMENT_TEST',
  'CONFIGURE_DATA_CAP',
];

const registry = new Map<string, ActionDef>(
  ACTION_REGISTRY.map((a) => [a.type, a])
);

export function listImplementedActions(): string[] {
  return ACTION_REGISTRY.filter((a) => a.implemented).map((a) => a.type);
}

export function listDeclaredNotImplemented(): string[] {
  return [...DECLARED_NOT_IMPLEMENTED];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function auditBase(ctx: ExecutorContext, installation: { id: string; siteId: string }) {
  return {
    tenantId: ctx.actor.tenantId,
    userId: ctx.actor.userId,
    installationId: installation.id,
    siteId: installation.siteId,
    correlationId: ctx.correlationId,
  };
}

async function findAsset(vendor: string, assetId: string) {
  if (vendor === 'MIKROTIK') {
    return prisma.router.findUnique({ where: { id: assetId }, select: { id: true, tenantId: true, siteId: true, serialNumber: true, hardwareMac: true } });
  }
  if (vendor === 'TPLINK') {
    return prisma.tpLinkRouter.findUnique({ where: { id: assetId }, select: { id: true, tenantId: true, siteId: true, serialNumber: true, hardwareMac: true } });
  }
  const site = await prisma.omadaSite.findUnique({ where: { id: assetId }, select: { id: true, tenantId: true, siteId: true } });
  return site ? { ...site, serialNumber: null, hardwareMac: null } : null;
}

async function bindAssetToSite(vendor: string, assetId: string, siteId: string, claim: { serialNumber?: string; macAddress?: string }) {
  const serial = normalizeRouterSerial(claim.serialNumber) ?? undefined;
  const mac = normalizeRouterMac(claim.macAddress) ?? undefined;
  const identity = {
    ...(serial ? { serialNumber: serial } : {}),
    ...(mac ? { hardwareMac: mac } : {}),
  };
  if (vendor === 'MIKROTIK') {
    await prisma.router.update({ where: { id: assetId }, data: { siteId, ...identity } });
  } else if (vendor === 'TPLINK') {
    await prisma.tpLinkRouter.update({ where: { id: assetId }, data: { siteId, ...identity } });
  } else {
    await prisma.omadaSite.update({ where: { id: assetId }, data: { siteId } });
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Execute a list of actions against an installation. Every action is gated,
 * schema-checked, audited, and its result recorded on the installation row.
 */
export async function executeActions(
  installationId: string,
  rawActions: unknown[],
  ctx: ExecutorContext
): Promise<{ results: ActionResult[]; allOk: boolean }> {
  const installation = await prisma.installation.findUnique({ where: { id: installationId } });
  if (!installation) forbidden('Installation not found');

  const runCtx: RunContext = {
    ...ctx,
    installation,
    getScopedRouter: async (assetId: string) => {
      const router = await prisma.router.findUnique({ where: { id: assetId } });
      if (!router || router.tenantId !== installation.tenantId || router.siteId !== installation.siteId) {
        forbidden('Device not in installation scope');
      }
      return router;
    },
  };

  const results: ActionResult[] = [];

  for (const raw of rawActions) {
    const parsedReq = actionRequestSchema.safeParse(raw);
    const actionId =
      (parsedReq.success && parsedReq.data.actionId) || `a${results.length + 1}`;
    const type = parsedReq.success ? parsedReq.data.type : 'unknown';

    const finish = async (status: ActionResult['status'], evidence?: unknown, error?: string) => {
      const result: ActionResult = { actionId, type, status, evidence: evidence ? sanitizeSecrets(evidence) : undefined, error, at: new Date().toISOString() };
      results.push(result);
      await recordAudit({
        ...auditBase(ctx, installation),
        action: status === 'OK' ? 'CONFIGURATION_EXECUTED' : status === 'DENIED' ? 'ACTION_DENIED' : 'CONFIGURATION_FAILED',
        targetType: 'action',
        targetId: actionId,
        result: status === 'OK' ? 'SUCCESS' : status === 'DENIED' ? 'DENIED' : 'FAILURE',
        metadata: { type, error: error ?? undefined },
      });
    };

    if (!parsedReq.success) {
      await finish('FAILED', undefined, 'Malformed action request');
      continue;
    }

    const entry =
      registry.get(type) ??
      (DECLARED_NOT_IMPLEMENTED.includes(type)
        ? { type, implemented: false }
        : undefined);

    if (!entry) {
      await finish('DENIED', undefined, `Unknown action type '${type}'`);
      continue;
    }

    const gate = gateAction(entry, {
      role: ctx.actor.role,
      tenantId: ctx.actor.tenantId,
      tokenScope: ctx.tokenScope,
      installation,
      approvals: installation.approvals as Array<{ step: string }> | null,
    });
    if (!gate.allowed) {
      await finish('DENIED', undefined, gate.error);
      continue;
    }

    if (!entry.implemented) {
      await finish('NOT_IMPLEMENTED', undefined, `${type} is declared but not implemented`);
      continue;
    }

    const pCheck = entry.paramsSchema ? entry.paramsSchema.safeParse(parsedReq.data.params) : { success: true as const, data: parsedReq.data.params };
    if (!pCheck.success) {
      await finish('FAILED', undefined, `Invalid params: ${pCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }

    try {
      const evidence = await entry.run!(pCheck.data as Record<string, unknown>, runCtx);
      await finish('OK', evidence);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : 'Action failed';
      logger.warn('Installation action failed', { installationId, type, actionId, statusCode, message });
      await finish(statusCode === 403 ? 'DENIED' : 'FAILED', undefined, message);
    }
  }

  // Persist ordered results onto the installation (append, never lose history).
  const existing = (installation.executionResults as ActionResult[] | null) ?? [];
  await prisma.installation.update({
    where: { id: installation.id },
    data: { executionResults: [...existing, ...results] as unknown as Prisma.InputJsonValue },
  });

  return { results, allOk: results.every((r) => r.status === 'OK' || r.status === 'NOT_IMPLEMENTED') };
}

export { DECLARED_NOT_IMPLEMENTED };
