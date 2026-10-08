/**
 * Installation namespace controllers — the deterministic wizard API.
 *
 * Every route here is scoped to /api/install and gated by role + optional
 * scoped-token claims. This namespace is the only surface an INSTALLER
 * account can reach; dashboard routes reject installers outright.
 */

import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AuthRequest } from '../types';
import { recordAudit } from '../services/audit.service';
import { validateContract } from '../services/installation/policy-validator.service';
import { executeActions, listImplementedActions, listDeclaredNotImplemented } from '../services/installation/action-executor.service';
import { getCapabilityRegistry } from '../config/capabilities';
import { storeInstallationSecret } from '../lib/secrets';
import { sanitizeSecrets } from '../lib/sanitize';
import { issueInstallerToken, revokeInstallerToken } from '../services/installer-token.service';
import { CONTRACT_VERSION, type ContractBody } from '../lib/installation-contract';

// ─── Lifecycle state machine ─────────────────────────────────────────────────

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_FOR_HARDWARE', 'CONFIGURING', 'FAILED', 'CANCELLED'],
  WAITING_FOR_HARDWARE: ['IN_PROGRESS', 'CONFIGURING', 'FAILED', 'CANCELLED'],
  CONFIGURING: ['VERIFYING', 'FAILED'],
  VERIFYING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['IN_PROGRESS'], // retry path
  CANCELLED: [],
};

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function httpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/** Resolve tenantId honoring SUPER_ADMIN body/query override. */
function callerTenantId(req: AuthRequest): string {
  const tid =
    req.user!.role === 'SUPER_ADMIN'
      ? ((req.body?.tenantId as string | undefined) ?? (req.query.tenantId as string | undefined) ?? req.user!.tenantId)
      : req.user!.tenantId;
  if (!tid) httpError(403, 'tenantId is required');
  return tid!;
}

/**
 * Enforce scoped-token claims. When the caller presents a scope='install'
 * token, the target installation/site must match the token's scope.
 */
function assertTokenScope(req: AuthRequest, ids: { installationId?: string; siteId?: string }): void {
  if (req.user?.scope !== 'install') return;
  if (req.user.installationId && ids.installationId && req.user.installationId !== ids.installationId) {
    httpError(403, 'Token is scoped to a different installation');
  }
  if (req.user.siteId && ids.siteId && req.user.siteId !== ids.siteId) {
    httpError(403, 'Token is scoped to a different site');
  }
  if (req.user.installationId && !ids.installationId) {
    httpError(403, 'Scoped token cannot call tenant-wide endpoints');
  }
}

/** Fetch an installation and verify tenant + token scope. */
async function scopedInstallation(req: AuthRequest, id: string) {
  const installation = await prisma.installation.findUnique({ where: { id } });
  if (!installation) httpError(404, 'Installation not found');
  if (req.user!.role !== 'SUPER_ADMIN' && installation.tenantId !== req.user!.tenantId) {
    httpError(403, 'Access denied to this tenant');
  }
  // Installers only see their own installations
  if (req.user!.role === 'INSTALLER' && installation.installerId !== req.user!.userId) {
    httpError(403, 'Installation is assigned to a different installer');
  }
  assertTokenScope(req, { installationId: installation.id, siteId: installation.siteId });
  return installation;
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export async function getCapabilities(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: getCapabilityRegistry(listImplementedActions(), listDeclaredNotImplemented()),
    });
  } catch (err) {
    next(err);
  }
}

// ─── Customers ───────────────────────────────────────────────────────────────

export async function createCustomer(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    assertTokenScope(req, {});
    const { name, contactName, phone, email, metadata } = req.body as {
      name: string; contactName?: string; phone?: string; email?: string; metadata?: object;
    };
    if (!name?.trim()) httpError(400, 'name is required');

    const customer = await prisma.customer.create({
      data: { tenantId, name: name.trim(), contactName, phone, email, metadata },
    });
    await recordAudit({ tenantId, userId: req.user!.userId, action: 'CUSTOMER_CREATED', targetType: 'customer', targetId: customer.id });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
}

export async function listCustomers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const customers = await prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sites: true } } },
    });
    res.json({ success: true, data: customers });
  } catch (err) {
    next(err);
  }
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export async function createSite(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    assertTokenScope(req, {});
    const { customerId, name, address, location, metadata } = req.body as {
      customerId?: string; name: string; address?: string; location?: string; metadata?: object;
    };
    if (!name?.trim()) httpError(400, 'name is required');

    if (customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.tenantId !== tenantId) httpError(400, 'customerId does not belong to this tenant');
    }

    const site = await prisma.site.create({
      data: { tenantId, customerId: customerId ?? null, name: name.trim(), address, location, metadata },
    });
    await recordAudit({ tenantId, userId: req.user!.userId, siteId: site.id, action: 'SITE_CREATED', targetType: 'site', targetId: site.id });
    res.status(201).json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
}

export async function listSites(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const sites = await prisma.site.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        _count: { select: { routers: true, tplinkRouters: true, omadaSites: true, installations: true } },
      },
    });
    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
}

export async function getSite(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const site = await prisma.site.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, contactName: true, phone: true } },
        routers: { select: { id: true, name: true, serialNumber: true, hardwareMac: true, status: true, model: true, routerOsVersion: true } },
        tplinkRouters: { select: { id: true, name: true, serialNumber: true, hardwareMac: true, status: true } },
        omadaSites: { select: { id: true, name: true, status: true, controllerUrl: true } },
        installations: { select: { id: true, status: true, stage: true, installerId: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!site || site.tenantId !== tenantId) httpError(404, 'Site not found');
    assertTokenScope(req, { siteId: site.id });
    res.json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
}

// ─── Installations ───────────────────────────────────────────────────────────

export async function createInstallation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { siteId, installerId, contract, idempotencyKey, metadata } = req.body as {
      siteId: string; installerId?: string; contract?: ContractBody; idempotencyKey?: string; metadata?: object;
    };
    if (!siteId) httpError(400, 'siteId is required');

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.tenantId !== tenantId) httpError(400, 'siteId does not belong to this tenant');

    // Installers can only create installations assigned to themselves.
    const assignedInstaller =
      req.user!.role === 'INSTALLER' ? req.user!.userId : installerId ?? req.user!.userId;
    const installer = await prisma.user.findUnique({ where: { id: assignedInstaller } });
    if (!installer || installer.tenantId !== tenantId) httpError(400, 'installerId does not belong to this tenant');

    if (idempotencyKey) {
      const existing = await prisma.installation.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, data: existing, reused: true });
        return;
      }
    }

    const installation = await prisma.installation.create({
      data: {
        tenantId,
        siteId,
        installerId: assignedInstaller,
        status: 'DRAFT',
        idempotencyKey: idempotencyKey ?? crypto.randomBytes(12).toString('base64url'),
        contractVersion: CONTRACT_VERSION,
        requestedConfig: contract ? (sanitizeSecrets(contract) as object) : undefined,
        metadata,
      },
    });
    await prisma.site.update({ where: { id: siteId }, data: { installationStatus: 'IN_PROGRESS' } });
    await recordAudit({ tenantId, userId: req.user!.userId, installationId: installation.id, siteId, action: 'INSTALLATION_CREATED', targetType: 'installation', targetId: installation.id });
    res.status(201).json({ success: true, data: installation });
  } catch (err) {
    next(err);
  }
}

export async function listInstallations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const where: Record<string, unknown> = { tenantId };
    if (req.user!.role === 'INSTALLER') where.installerId = req.user!.userId;
    if (req.user!.scope === 'install' && req.user!.installationId) where.id = req.user!.installationId;
    if (typeof req.query.status === 'string') where.status = req.query.status;

    const installations = await prisma.installation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        site: { select: { id: true, name: true, customer: { select: { id: true, name: true } } } },
        installer: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({ success: true, data: installations });
  } catch (err) {
    next(err);
  }
}

export async function getInstallation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const full = await prisma.installation.findUnique({
      where: { id: installation.id },
      include: {
        site: { include: { customer: true } },
        installer: { select: { id: true, name: true, email: true } },
        secrets: { select: { id: true, kind: true, label: true, consumedAt: true, createdAt: true } },
      },
    });
    res.json({ success: true, data: sanitizeSecrets(full) });
  } catch (err) {
    next(err);
  }
}

export async function updateContract(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    if (!['DRAFT', 'IN_PROGRESS'].includes(installation.status)) {
      httpError(409, `Contract cannot be edited while installation is ${installation.status}`);
    }
    const contract = req.body?.contract;
    if (!contract) httpError(400, 'contract is required');

    const updated = await prisma.installation.update({
      where: { id: installation.id },
      data: {
        requestedConfig: sanitizeSecrets(contract) as object,
        validatedConfig: Prisma.DbNull, // any edit invalidates prior validation
        revision: { increment: 1 },
      },
    });
    await recordAudit({ tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId, action: 'CONFIGURATION_REQUESTED', targetType: 'installation', targetId: installation.id, metadata: { revision: updated.revision } });
    res.json({ success: true, data: { id: updated.id, revision: updated.revision } });
  } catch (err) {
    next(err);
  }
}

export async function validateInstallation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    if (TERMINAL.has(installation.status)) httpError(409, `Installation is ${installation.status}`);

    const outcome = validateContract(installation.requestedConfig ?? {});

    await recordAudit({
      tenantId: installation.tenantId,
      userId: req.user!.userId,
      installationId: installation.id,
      siteId: installation.siteId,
      action: outcome.valid ? 'CONFIGURATION_VALIDATED' : 'CONFIGURATION_REJECTED',
      targetType: 'installation',
      targetId: installation.id,
      result: outcome.valid ? 'SUCCESS' : 'FAILURE',
      metadata: { errorCount: outcome.errors.length, errors: outcome.errors.slice(0, 20) },
    });

    if (outcome.valid) {
      await prisma.installation.update({
        where: { id: installation.id },
        data: { validatedConfig: installation.requestedConfig as object, revision: { increment: 1 } },
      });
    }

    res.json({
      success: true,
      data: { valid: outcome.valid, errors: outcome.errors, revision: outcome.valid ? installation.revision + 1 : installation.revision },
    });
  } catch (err) {
    next(err);
  }
}

export async function executeInstallation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const actions = req.body?.actions;
    if (!Array.isArray(actions) || actions.length === 0) httpError(400, 'actions array is required');
    if (actions.length > 50) httpError(400, 'too many actions in one request');

    const tenantId = installation.tenantId;
    const { results, allOk } = await executeActions(installation.id, actions, {
      actor: { userId: req.user!.userId, role: req.user!.role, tenantId },
      tokenScope:
        req.user!.scope === 'install'
          ? { installationId: req.user!.installationId, siteId: req.user!.siteId }
          : undefined,
      correlationId: (req.headers['x-correlation-id'] as string) ?? undefined,
    });

    res.json({ success: true, data: { results, allOk } });
  } catch (err) {
    next(err);
  }
}

export async function transitionInstallation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const to = req.body?.to as string;
    const failureReason = req.body?.failureReason as string | undefined;
    if (!to) httpError(400, 'to is required');

    const allowed = TRANSITIONS[installation.status] ?? [];
    if (!allowed.includes(to)) {
      await recordAudit({
        tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
        action: 'INSTALLATION_STATUS_CHANGED', targetType: 'installation', targetId: installation.id,
        result: 'DENIED', metadata: { from: installation.status, to },
      });
      httpError(409, `Invalid transition ${installation.status} → ${to}`);
    }

    const updated = await prisma.installation.update({
      where: { id: installation.id },
      data: {
        status: to as never,
        ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(to === 'FAILED' ? { failureReason: failureReason ?? 'unspecified' } : {}),
      },
    });

    if (to === 'COMPLETED') {
      await prisma.site.update({ where: { id: installation.siteId }, data: { installationStatus: 'ONLINE' } });
    } else if (to === 'FAILED') {
      await prisma.site.update({ where: { id: installation.siteId }, data: { installationStatus: 'FAILED' } });
    }

    await recordAudit({
      tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
      action: to === 'COMPLETED' ? 'INSTALLATION_COMPLETED' : to === 'CANCELLED' ? 'INSTALLATION_CANCELLED' : to === 'FAILED' ? 'INSTALLATION_STATUS_CHANGED' : 'INSTALLATION_STATUS_CHANGED',
      targetType: 'installation', targetId: installation.id,
      metadata: { from: installation.status, to, failureReason },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ─── Installation secrets ────────────────────────────────────────────────────

export async function createInstallationSecret(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    if (TERMINAL.has(installation.status)) httpError(409, `Installation is ${installation.status}`);
    const { kind, value, label } = req.body as { kind?: string; value?: string; label?: string };
    if (!kind?.trim() || !value) httpError(400, 'kind and value are required');

    const { secretRef, secretId } = await storeInstallationSecret(installation.id, kind.trim(), value, label);
    await recordAudit({
      tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
      action: 'SECRET_CREATED', targetType: 'installation_secret', targetId: secretId, metadata: { kind: kind.trim(), label },
    });
    // Only the reference is returned — never the plaintext.
    res.status(201).json({ success: true, data: { secretRef, secretId } });
  } catch (err) {
    next(err);
  }
}

export async function listInstallationSecrets(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const secrets = await prisma.installationSecret.findMany({
      where: { installationId: installation.id },
      select: { id: true, kind: true, label: true, consumedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      success: true,
      data: secrets.map((s) => ({ ...s, secretRef: `secret://installation/${installation.id}/${s.id}` })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── Scoped installer tokens ─────────────────────────────────────────────────

export async function issueToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    if (TERMINAL.has(installation.status)) httpError(409, `Installation is ${installation.status}`);

    // An installer may issue a token for their own installation; merchant/admin
    // may issue for any installer in the tenant.
    const targetInstallerId =
      req.user!.role === 'INSTALLER' ? req.user!.userId : (req.body?.installerId as string | undefined) ?? installation.installerId;
    const installer = await prisma.user.findUnique({ where: { id: targetInstallerId } });
    if (!installer || installer.tenantId !== installation.tenantId || installer.role !== 'INSTALLER') {
      httpError(400, 'installerId must reference an INSTALLER in this tenant');
    }

    const { token, jti, expiresAt } = await issueInstallerToken({
      installerId: installer.id,
      tenantId: installation.tenantId,
      installationId: installation.id,
      siteId: installation.siteId,
      ttlSeconds: typeof req.body?.ttlSeconds === 'number' ? Math.min(req.body.ttlSeconds, 86400) : undefined,
    });
    await recordAudit({
      tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
      action: 'INSTALLER_TOKEN_ISSUED', targetType: 'installer_token', targetId: jti, metadata: { installerId: installer.id, expiresAt },
    });
    res.status(201).json({ success: true, data: { token, jti, expiresAt } });
  } catch (err) {
    next(err);
  }
}

export async function revokeToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const jti = req.params.jti;
    const ok = await revokeInstallerToken(jti, installation.tenantId);
    if (!ok) httpError(404, 'Token not found');
    await recordAudit({
      tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
      action: 'INSTALLER_TOKEN_REVOKED', targetType: 'installer_token', targetId: jti,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── Installer accounts ──────────────────────────────────────────────────────

export async function createInstaller(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
    if (!name?.trim() || !email?.trim() || !password) httpError(400, 'name, email, password are required');
    if (password.length < 8) httpError(400, 'password must be at least 8 characters');

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) httpError(409, 'A user with this email already exists');

    const installer = await prisma.user.create({
      data: {
        tenantId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        role: 'INSTALLER',
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    await recordAudit({ tenantId, userId: req.user!.userId, action: 'INSTALLER_CREATED', targetType: 'user', targetId: installer.id });
    res.status(201).json({ success: true, data: installer });
  } catch (err) {
    next(err);
  }
}

export async function listInstallers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const installers = await prisma.user.findMany({
      where: { tenantId, role: 'INSTALLER' },
      select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: installers });
  } catch (err) {
    next(err);
  }
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export async function getInstallationAudit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const logs = await prisma.auditLog.findMany({
      where: { installationId: installation.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

export async function getTenantAudit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

// ─── Diagnostics (allowlisted — no arbitrary commands) ───────────────────────

export async function runDiagnostic(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const installation = await scopedInstallation(req, req.params.id);
    const { check, assetId } = req.body as { check?: string; assetId?: string };
    await recordAudit({
      tenantId: installation.tenantId, userId: req.user!.userId, installationId: installation.id, siteId: installation.siteId,
      action: 'DIAGNOSTIC_STARTED', targetType: check ?? 'unknown', targetId: assetId,
    });

    // Diagnostics reuse the executor's closed vocabulary so they inherit the
    // same policy gate — no arbitrary read commands.
    const typeMap: Record<string, string> = {
      connectivity: 'RUN_CONNECTIVITY_TEST',
      router_identity: 'READ_ROUTER_IDENTITY',
      router_discovery: 'DISCOVER_ROUTER',
    };
    const type = typeMap[check ?? ''];
    if (!type || !assetId) httpError(400, `check must be one of: ${Object.keys(typeMap).join(', ')} and assetId is required`);

    const { results } = await executeActions(installation.id, [{ type, params: { assetId } }], {
      actor: { userId: req.user!.userId, role: req.user!.role, tenantId: installation.tenantId },
      tokenScope: req.user!.scope === 'install' ? { installationId: req.user!.installationId, siteId: req.user!.siteId } : undefined,
    });
    res.json({ success: true, data: results[0] });
  } catch (err) {
    next(err);
  }
}
