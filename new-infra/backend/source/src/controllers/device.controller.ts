/**
 * Device inventory controllers — scan/identify, register, assign, reassign,
 * history. All routes live under /api/install/devices so they inherit the
 * installer auth + scoped-token middleware from install.routes.ts.
 */

import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';
import { recordAudit } from '../services/audit.service';
import { sanitizeSecrets } from '../lib/sanitize';
import { createError } from '../middleware/errorHandler';
import {
  normalizeScannedPayload,
  findDeviceByIdentity,
  registerDevice,
  registerDeviceSchema,
  assignDeviceToSite,
  reassignDevice,
  getDeviceHistory,
} from '../services/devices/device.service';

function httpError(statusCode: number, message: string): never {
  throw createError(message, statusCode);
}

function callerTenantId(req: AuthRequest): string {
  const tid =
    req.user!.role === 'SUPER_ADMIN'
      ? ((req.body?.tenantId as string | undefined) ?? (req.query.tenantId as string | undefined) ?? req.user!.tenantId)
      : req.user!.tenantId;
  if (!tid) httpError(403, 'tenantId is required');
  return tid!;
}

/**
 * POST /devices/identify — normalize a scanned payload and look the device up.
 * Returns FOUND (with assignment state) or NOT_FOUND (with normalized fields
 * so the UI can pre-fill a registration form). Does NOT create anything.
 */
export async function identifyScannedDevice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { payload } = req.body as { payload?: string };
    if (!payload?.trim()) httpError(400, 'payload is required');

    const identity = normalizeScannedPayload(payload);
    const found = await findDeviceByIdentity(identity);

    // A device belonging to another tenant must not leak — report NOT_FOUND.
    const visible = found && found.tenantId === tenantId ? found : null;

    await recordAudit({
      tenantId, userId: req.user!.userId,
      action: 'DEVICE_SCANNED', targetType: 'device', targetId: visible?.id,
      result: visible ? 'SUCCESS' : 'FAILURE',
      metadata: { hasSerial: Boolean(identity.serialNumber), hasMac: Boolean(identity.macAddress), found: Boolean(visible) },
    });

    res.json({
      success: true,
      data: {
        result: visible ? 'FOUND' : 'NOT_FOUND',
        identity: sanitizeSecrets(identity),
        device: visible ? sanitizeSecrets(visible) : null,
        alreadyAssigned: Boolean(visible?.siteId),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/register — create a Device from scan/manual input. */
export async function registerDeviceHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const parsed = registerDeviceSchema.safeParse(req.body);
    if (!parsed.success) httpError(400, `Invalid device payload: ${parsed.error.issues[0]?.message}`);

    const device = await registerDevice(tenantId, req.user!.userId, parsed.data);
    res.status(201).json({ success: true, data: sanitizeSecrets(device) });
  } catch (err) {
    next(err);
  }
}

export async function listDevices(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const where: Record<string, unknown> = { tenantId };
    if (typeof req.query.siteId === 'string') where.siteId = req.query.siteId;
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.vendor === 'string') where.vendor = req.query.vendor;

    const devices = await prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { site: { select: { id: true, name: true } }, router: { select: { id: true, status: true } } },
      take: 500,
    });
    res.json({ success: true, data: sanitizeSecrets(devices) });
  } catch (err) {
    next(err);
  }
}

export async function getDevice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: {
        site: { select: { id: true, name: true } },
        router: true, tpLinkRouter: true, omadaSite: true,
        installedBy: { select: { id: true, name: true } },
      },
    });
    if (!device || device.tenantId !== tenantId) httpError(404, 'Device not found');
    res.json({ success: true, data: sanitizeSecrets(device) });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/:id/assign — first-time assignment only. */
export async function assignDevice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { siteId, installationId } = req.body as { siteId?: string; installationId?: string };
    if (!siteId) httpError(400, 'siteId is required');
    const device = await assignDeviceToSite(req.params.id, siteId, { id: req.user!.userId, tenantId }, { installationId });
    res.json({ success: true, data: sanitizeSecrets(device) });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/:id/reassign — explicit move between sites, reason required. */
export async function reassignDeviceHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { siteId, reason } = req.body as { siteId?: string; reason?: string };
    if (!siteId) httpError(400, 'siteId is required');
    const device = await reassignDevice(req.params.id, siteId, reason ?? '', { id: req.user!.userId, tenantId });
    res.json({ success: true, data: sanitizeSecrets(device) });
  } catch (err) {
    next(err);
  }
}

export async function getDeviceHistoryHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { device, history } = await getDeviceHistory(req.params.id, tenantId);
    res.json({ success: true, data: { device: sanitizeSecrets(device), history } });
  } catch (err) {
    next(err);
  }
}

// ─── Hardware Lab — physical test-run recording (spec §16) ──────────────────

export async function recordHardwareTest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const { deviceId, siteId, installationId, testName, result, durationMs, configVersion, logs } = req.body as {
      deviceId?: string; siteId?: string; installationId?: string;
      testName?: string; result?: string; durationMs?: number; configVersion?: string; logs?: object;
    };
    if (!testName?.trim()) httpError(400, 'testName is required');
    if (!result || !['PASS', 'FAIL', 'INFO', 'SKIP'].includes(result)) httpError(400, 'result must be PASS|FAIL|INFO|SKIP');

    // Lab evidence must stay inside the caller's tenant.
    if (deviceId) {
      const d = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!d || d.tenantId !== tenantId) httpError(400, 'deviceId not in this tenant');
    }
    if (siteId) {
      const s = await prisma.site.findUnique({ where: { id: siteId } });
      if (!s || s.tenantId !== tenantId) httpError(400, 'siteId not in this tenant');
    }

    const run = await prisma.hardwareTestRun.create({
      data: {
        tenantId,
        deviceId: deviceId ?? null,
        siteId: siteId ?? null,
        installationId: installationId ?? null,
        operatorId: req.user!.userId,
        testName: testName.trim(),
        result: result as 'PASS' | 'FAIL' | 'INFO' | 'SKIP',
        durationMs: durationMs ?? null,
        configVersion: configVersion ?? null,
        logs: logs ? (sanitizeSecrets(logs) as object) : undefined,
      },
    });
    await recordAudit({
      tenantId, userId: req.user!.userId, siteId: siteId ?? undefined, installationId: installationId ?? undefined,
      action: 'HARDWARE_TEST_RECORDED', targetType: 'hardware_test_run', targetId: run.id,
      result: result === 'PASS' ? 'SUCCESS' : 'FAILURE',
      metadata: { testName, result, deviceId },
    });
    res.status(201).json({ success: true, data: run });
  } catch (err) {
    next(err);
  }
}

export async function listHardwareTests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = callerTenantId(req);
    const where: Record<string, unknown> = { tenantId };
    if (typeof req.query.deviceId === 'string') where.deviceId = req.query.deviceId;
    if (typeof req.query.siteId === 'string') where.siteId = req.query.siteId;
    const runs = await prisma.hardwareTestRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { operator: { select: { id: true, name: true } } },
      take: 200,
    });
    res.json({ success: true, data: runs });
  } catch (err) {
    next(err);
  }
}
