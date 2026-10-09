/**
 * Device inventory service — scan normalization, registration, assignment,
 * reassignment and history. Device identity is the ownership boundary:
 * MAC / serial / barcode are unique; cross-site moves require an explicit
 * reassignment (who + why) — never silent.
 */

import { z } from 'zod';
import { DeviceStatus, DeviceProvisioningStatus, DeviceVendor, DeviceType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { normalizeRouterMac, normalizeRouterSerial } from '../router-provisioning.service';
import { recordAudit } from '../audit.service';
import { sanitizeSecrets } from '../../lib/sanitize';
import { createError } from '../../middleware/errorHandler';

// ─── Scan payload normalization ──────────────────────────────────────────────

export interface ScannedIdentity {
  serialNumber?: string;
  macAddress?: string;
  barcodeValue: string;
  vendorHint?: DeviceVendor;
  modelHint?: string;
}

const MAC_RE = /^([0-9a-fA-F]{2}[:\-]?){5}[0-9a-fA-F]{2}$/;
const SERIAL_RE = /^[0-9A-Fa-f]{6,20}$/;           // MikroTik-style hex serial
const MODEL_RES: Array<[RegExp, string]> = [
  [/hap/i, 'hAP'],
  [/rb\d{3,4}/i, 'RB'],
  [/eap\s?\d+/i, 'EAP'],
  [/crs\d+/i, 'CRS'],
];

/**
 * Normalize whatever a barcode/QR/label scanner produced into device identity
 * fields. Labels are inconsistent — accept raw serials, MACs, JSON blobs, and
 * vendor-prefixed strings like "MIKROTIK:SN:MAC" or "S/N:xxxx MAC:xx:xx:…".
 */
export function normalizeScannedPayload(raw: string): ScannedIdentity {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) {
    throw createError('Invalid scan payload', 400);
  }

  // JSON payload (some QR labels encode a whole object)
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        serialNumber: normalizeRouterSerial(String(obj.serial ?? obj.serialNumber ?? obj.sn ?? '') || '') || undefined,
        macAddress: normalizeRouterMac(String(obj.mac ?? obj.macAddress ?? obj.macaddress ?? '') || '') || undefined,
        barcodeValue: trimmed,
        vendorHint: vendorFromString(String(obj.vendor ?? obj.brand ?? '')),
        modelHint: typeof obj.model === 'string' ? obj.model.slice(0, 64) : undefined,
      };
    } catch {
      // fall through to text heuristics
    }
  }

  // Field-labeled text: "S/N: F43E0FEFA14C MAC: DC:2C:6E:C9:D9:B0" or
  // "MIKROTIK-F43E0FEFA14C-DC2C6EC9D9B0"
  // A MAC is only taken from a separated form or an explicit MAC label — a
  // bare 12-hex run is ambiguous with MikroTik serials, so serials win there.
  const labeledMac = trimmed.match(/(?:mac|hwaddr|ether)\s*[:#=]?\s*((?:[0-9a-fA-F]{2}[:\-]?){5}[0-9a-fA-F]{2})/i);
  const separatedMac = trimmed.match(/(?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}/);
  const serialLabeled = trimmed.match(/(?:s\/?n|serial)\s*[:#=]?\s*([0-9A-Za-z]{4,32})/i);

  const identity: ScannedIdentity = { barcodeValue: trimmed };

  const macCandidate = labeledMac?.[1] ?? separatedMac?.[0];
  if (macCandidate) {
    const normalized = normalizeRouterMac(macCandidate);
    if (normalized) identity.macAddress = normalized;
  }
  if (serialLabeled) {
    identity.serialNumber = normalizeRouterSerial(serialLabeled[1]) || undefined;
  } else if (!identity.macAddress && SERIAL_RE.test(trimmed)) {
    // Bare hex serial (typical MikroTik label)
    identity.serialNumber = normalizeRouterSerial(trimmed) || undefined;
  }
  // Vendor detection scans the whole label — "TP-LINK Omada" means OMADA,
  // not TPLINK, so omada is checked before the parent brand.
  identity.vendorHint = vendorFromString(trimmed);

  const modelMatch = MODEL_RES.find(([re]) => re.test(trimmed));
  if (modelMatch) identity.modelHint = trimmed.match(modelMatch[0])?.[0]?.slice(0, 64);

  return identity;
}

function vendorFromString(v: string): DeviceVendor | undefined {
  const s = v.toLowerCase();
  if (s.includes('mikrotik')) return 'MIKROTIK';
  // Omada before TP-Link: EAP labels read "TP-LINK Omada" — the product line
  // is the adapter-relevant vendor, not the parent brand.
  if (s.includes('omada')) return 'OMADA';
  if (s.includes('tplink') || s.includes('tp-link') || s.includes('tp_link')) return 'TPLINK';
  if (s.includes('ubnt') || s.includes('ubiquiti')) return 'UBNT';
  if (s.includes('openwrt')) return 'OPENWRT';
  return undefined;
}

// ─── Registration / lookup ───────────────────────────────────────────────────

export const registerDeviceSchema = z.object({
  vendor: z.nativeEnum(DeviceVendor),
  deviceType: z.nativeEnum(DeviceType).default('OTHER'),
  model: z.string().trim().max(64).optional(),
  serialNumber: z.string().trim().min(4).max(64).optional(),
  macAddress: z.string().optional(),
  assetTag: z.string().trim().max(64).optional(),
  barcodeValue: z.string().trim().max(512).optional(),
  siteId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export class DeviceConflictError extends Error {
  constructor(public readonly existing: { id: string; siteId: string | null; status: string }, field: string) {
    super(`A device with this ${field} is already registered`);
    this.name = 'DeviceConflictError';
    (this as { statusCode?: number; isOperational?: boolean }).statusCode = 409;
    (this as { statusCode?: number; isOperational?: boolean }).isOperational = true;
  }
}

/** Find a device by any normalized identity field — the scan-match path. */
export async function findDeviceByIdentity(identity: { serialNumber?: string; macAddress?: string; barcodeValue?: string }) {
  const mac = normalizeRouterMac(identity.macAddress);
  const serial = normalizeRouterSerial(identity.serialNumber);
  const clauses = [
    serial ? { serialNumber: serial } : null,
    mac ? { macAddress: mac } : null,
    identity.barcodeValue ? { barcodeValue: identity.barcodeValue } : null,
  ].filter(Boolean) as Prisma.DeviceWhereInput[];
  if (!clauses.length) return null;
  return prisma.device.findFirst({
    where: { OR: clauses },
    include: { site: { select: { id: true, name: true } } },
  });
}

export async function registerDevice(
  tenantId: string,
  actorId: string,
  input: z.infer<typeof registerDeviceSchema>
) {
  const serial = normalizeRouterSerial(input.serialNumber);
  const mac = normalizeRouterMac(input.macAddress);

  // Duplicate protection across all identity fields.
  const existing = await findDeviceByIdentity({ serialNumber: serial, macAddress: mac, barcodeValue: input.barcodeValue });
  if (existing) {
    const field = existing.serialNumber === serial ? 'serial number' : existing.macAddress === mac ? 'MAC address' : 'barcode';
    throw new DeviceConflictError({ id: existing.id, siteId: existing.siteId, status: existing.status }, field);
  }

  const device = await prisma.device.create({
    data: {
      tenantId,
      vendor: input.vendor,
      deviceType: input.deviceType,
      model: input.model,
      serialNumber: serial,
      macAddress: mac,
      assetTag: input.assetTag,
      barcodeValue: input.barcodeValue,
      siteId: input.siteId,
      identitySource: 'SCAN',
      status: input.siteId ? 'AVAILABLE' : 'UNASSIGNED',
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  await recordAudit({
    tenantId, userId: actorId, siteId: device.siteId ?? undefined,
    action: 'DEVICE_REGISTERED', targetType: 'device', targetId: device.id,
    metadata: { vendor: device.vendor, deviceType: device.deviceType, hasSerial: Boolean(serial), hasMac: Boolean(mac) },
  });
  return device;
}

// ─── Assignment / reassignment ───────────────────────────────────────────────

export async function assignDeviceToSite(
  deviceId: string,
  siteId: string,
  actor: { id: string; tenantId: string },
  opts: { installationId?: string } = {}
) {
  const [device, site] = await Promise.all([
    prisma.device.findUnique({ where: { id: deviceId } }),
    prisma.site.findUnique({ where: { id: siteId } }),
  ]);
  if (!device || device.tenantId !== actor.tenantId) throw createError('Device not found', 404);
  if (!site || site.tenantId !== actor.tenantId) throw createError('Site not found', 404);

  if (device.siteId && device.siteId !== siteId) {
    // Never silently reassign — the caller must use reassignDevice.
    throw createError('DEVICE_ALREADY_ASSIGNED — use the reassignment workflow', 409);
  }

  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: {
      siteId,
      status: 'INSTALLING',
      installedById: actor.id,
      installationId: opts.installationId,
      installedAt: new Date(),
    },
  });
  await recordAudit({
    tenantId: actor.tenantId, userId: actor.id, siteId, installationId: opts.installationId,
    action: 'DEVICE_ASSIGNED', targetType: 'device', targetId: deviceId,
    metadata: { siteId, previousSiteId: device.siteId },
  });
  return updated;
}

export async function reassignDevice(
  deviceId: string,
  newSiteId: string,
  reason: string,
  actor: { id: string; tenantId: string }
) {
  if (!reason || reason.trim().length < 3) {
    throw createError('Reassignment requires a reason', 400);
  }
  const [device, site] = await Promise.all([
    prisma.device.findUnique({ where: { id: deviceId } }),
    prisma.site.findUnique({ where: { id: newSiteId } }),
  ]);
  if (!device || device.tenantId !== actor.tenantId) throw createError('Device not found', 404);
  if (!site || site.tenantId !== actor.tenantId) throw createError('Site not found', 404);

  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: { siteId: newSiteId, status: 'INSTALLING' },
  });
  await recordAudit({
    tenantId: actor.tenantId, userId: actor.id, siteId: newSiteId,
    action: 'DEVICE_REASSIGNED', targetType: 'device', targetId: deviceId,
    metadata: { fromSiteId: device.siteId, toSiteId: newSiteId, reason },
  });
  return updated;
}

export async function getDeviceHistory(deviceId: string, tenantId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.tenantId !== tenantId) throw createError('Device not found', 404);
  const logs = await prisma.auditLog.findMany({
    where: { targetType: 'device', targetId: deviceId, tenantId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return { device, history: sanitizeSecrets(logs) };
}

export async function updateDeviceStatus(
  deviceId: string,
  tenantId: string,
  patch: { status?: DeviceStatus; provisioningStatus?: DeviceProvisioningStatus; lastSeenAt?: Date; metadata?: Record<string, unknown> }
) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.tenantId !== tenantId) throw createError('Device not found', 404);
  return prisma.device.update({
    where: { id: deviceId },
    data: { ...patch, metadata: patch.metadata ? (patch.metadata as Prisma.InputJsonValue) : undefined },
  });
}
