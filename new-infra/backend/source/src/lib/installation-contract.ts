/**
 * Structured installation configuration contract — Phase 5A implementation of
 * docs/trivaconnect-copilot/configuration-contract.md. This is the canonical
 * schema; the wizard, validator, executor, and (later) Gemini all speak it.
 *
 * Every configurable value is wrapped: { value, source, state } so the system
 * always knows who proposed it and whether it is authoritative. Secrets appear
 * only as secretRef nodes — never inline plaintext.
 */

import { z } from 'zod';

export const CONTRACT_VERSION = '1.0';

// ─── Source / state vocabularies (closed enums, per the contract doc) ────────

export const VALUE_SOURCES = [
  'INSTALLER',
  'CUSTOMER',
  'DISCOVERY',
  'DERIVED',
  'DEFAULT',
  'ADMIN_DEFINED',
  'SYSTEM',
  'GEMINI_RECOMMENDED',
  'DETERMINISTIC',
] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export const VALUE_STATES = [
  'PROPOSED',
  'CONFIRMED',
  'VERIFIED',
  'CLAIM',
  'REJECTED',
] as const;
export type ValueState = (typeof VALUE_STATES)[number];

/** Sources a non-system proposer (wizard field / future Gemini) may set. */
export const PROPOSABLE_SOURCES: ValueSource[] = ['INSTALLER', 'CUSTOMER', 'GEMINI_RECOMMENDED'];

/** Wraps any zod schema in the contract's {value, source, state} envelope. */
function valued<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    source: z.enum(VALUE_SOURCES).optional(),
    state: z.enum(VALUE_STATES).optional(),
  });
}

const nonEmptyString = z.string().trim().min(1).max(200);
const phone = z.string().trim().regex(/^\+?[0-9()\-\s]{7,20}$/, 'invalid phone');
const email = z.string().trim().email().max(200);
const cidr = z.string().trim().regex(
  /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
  'must be CIDR notation (e.g. 192.168.88.0/24)'
);
const ipv4 = z.string().trim().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'must be an IPv4 address');
const mac = z.string().trim().regex(/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, 'must be a MAC address');
const secretRefNode = z.object({
  secretRef: z.string().regex(/^secret:\/\/[a-z-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/),
}).strict();

export const INSTALLATION_STAGES = [
  'CUSTOMER', 'SITE', 'HARDWARE', 'WAN', 'LAN', 'WIFI',
  'CAPTIVE_PORTAL', 'BILLING', 'SECURITY', 'VERIFICATION', 'COMPLETION',
] as const;

export const INSTALLATION_STATUSES = [
  'DRAFT', 'IN_PROGRESS', 'WAITING_FOR_HARDWARE', 'CONFIGURING',
  'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const;

/** Allowed site profiles — Gemini may select among these, never invent new ones. */
export const CONFIG_PROFILES = ['TRIVA_BASIC', 'TRIVA_STANDARD', 'TRIVA_BUSINESS', 'CUSTOM'] as const;

export const WALLED_GARDEN_HOSTS = [
  'trivaconnect.site',
  '*.trivaconnect.site',
  'anypaytanzania.com',
  '*.anypaytanzania.com',
] as const;

// ─── Contract body ───────────────────────────────────────────────────────────

export const planSpecSchema = z.object({
  name: nonEmptyString,
  priceTZS: z.number().int().positive().max(10_000_000),
  durationMins: z.number().int().min(1).max(43_200),
  downloadKbps: z.number().int().positive().max(1_000_000).nullable().optional(),
  uploadKbps: z.number().int().positive().max(1_000_000).nullable().optional(),
  dataLimitMb: z.number().int().positive().nullable().optional(),
});

export const contractBodySchema = z.object({
  customer: z.object({
    businessName: valued(nonEmptyString),
    contactPerson: valued(nonEmptyString).optional(),
    phone: valued(phone).optional(),
    email: valued(email).optional(),
    address: valued(z.string().trim().max(500)).optional(),
  }).partial().optional(),

  site: z.object({
    name: valued(nonEmptyString),
    location: valued(z.string().trim().max(500)).optional(),
    expectedUsers: valued(z.number().int().min(1).max(5000)).optional(),
    profile: valued(z.enum(CONFIG_PROFILES)).optional(),
    coverage: valued(z.enum(['indoor', 'outdoor', 'both'])).optional(),
    accessPointCount: valued(z.number().int().min(0).max(100)).optional(),
  }).partial().optional(),

  devices: z.object({
    mikrotik: z.object({
      assetId: z.string().optional(),
      identity: z.object({
        scannedMac: valued(mac).optional(),
        scannedSerial: valued(z.string().trim().min(4).max(64)).optional(),
        reportedMac: valued(mac).optional(),
        reportedSerial: valued(z.string().trim().min(4).max(64)).optional(),
        model: valued(z.string().trim().max(64)).optional(),
        routerOsVersion: valued(z.string().trim().max(32)).optional(),
        observedSourceIp: valued(ipv4).optional(),
        match: valued(z.enum(['UNMATCHED', 'MATCHED', 'MISMATCH', 'ALREADY_OWNED'])).optional(),
      }).partial().optional(),
      hotspotName: valued(z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/)).optional(),
      controlPlaneIp: valued(ipv4).optional(),
      credentials: z.object({
        apiUserRef: secretRefNode.optional(),
        apiPasswordRef: secretRefNode.optional(),
        provisioningKeyRef: secretRefNode.optional(),
      }).optional(),
    }).optional(),
    omada: z.object({
      siteAssetId: z.string().optional(),
      controllerUrl: valued(z.string().trim().url().max(200)).optional(),
      controllerIp: valued(ipv4).optional(),
      accessPoints: z.array(z.object({
        labelMac: valued(mac).optional(),
        reportedMac: valued(mac).optional(),
        model: valued(z.string().trim().max(64)).optional(),
        adopted: valued(z.boolean()).optional(),
        match: valued(z.enum(['UNMATCHED', 'MATCHED', 'MISMATCH', 'ALREADY_OWNED'])).optional(),
      })).optional(),
      credentials: z.object({
        controllerAuthRef: secretRefNode.optional(),
        radiusSecretRef: secretRefNode.optional(),
      }).optional(),
    }).optional(),
  }).optional(),

  network: z.object({
    wan: z.object({
      type: valued(z.enum(['DHCP', 'STATIC', 'PPPOE'])),
      static: valued(z.object({
        ip: ipv4,
        gateway: ipv4,
        dns: z.array(ipv4).max(4).optional(),
      })).optional(),
      pppoeRef: secretRefNode.optional(),
      reachability: valued(z.enum(['CONFIRMED', 'FAILED', 'UNKNOWN'])).optional(),
    }).partial().optional(),
    lan: z.object({
      subnet: valued(cidr),
      dhcpPool: valued(z.string().trim().regex(/^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/)).optional(),
      dns: valued(z.array(ipv4).max(4)).optional(),
      nat: valued(z.boolean()).optional(),
    }).partial().optional(),
    firewallProfile: valued(z.enum(['TRIVA_BASELINE'])).optional(),
    vlans: valued(z.array(z.object({
      id: z.number().int().min(1).max(4094),
      name: nonEmptyString,
      subnet: cidr,
    })).max(8)).optional(),
  }).partial().optional(),

  wifi: z.object({
    ssid: valued(z.string().trim().min(1).max(32)),
    hidden: valued(z.boolean()).optional(),
    security: valued(z.enum(['OPEN_PORTAL'])).optional(),
    clientIsolation: valued(z.boolean()).optional(),
    band: valued(z.enum(['2.4', '5', '2.4+5'])).optional(),
  }).partial().optional(),

  captivePortal: z.object({
    enabled: valued(z.boolean()).optional(),
    mode: valued(z.enum(['MIKROTIK_HOTSPOT', 'OMADA_EXTERNAL'])).optional(),
    walledGarden: valued(z.array(z.string().trim().max(100)).max(20)).optional(),
    branding: valued(z.object({
      noticeName: z.string().trim().max(60).optional(),
      message: z.string().trim().max(280).optional(),
      color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })).optional(),
  }).partial().optional(),

  billing: z.object({
    enabled: valued(z.boolean()).optional(),
    provider: valued(z.enum(['ANYPAY', 'VOUCHER'])).optional(),
    credentialRef: secretRefNode.optional(),
    plans: valued(z.array(planSpecSchema).min(1).max(20)).optional(),
    vouchersEnabled: valued(z.boolean()).optional(),
  }).partial().optional(),

  omadaRadius: z.object({
    radiusSecretRef: secretRefNode.optional(),
    tokenTtlSeconds: valued(z.number().int().min(30).max(300)).optional(),
    nasRegistered: valued(z.boolean()).optional(),
  }).partial().optional(),

  operations: z.object({
    monitoring: valued(z.boolean()).optional(),
    supportContact: valued(phone).optional(),
    installerNotes: valued(z.string().trim().max(1000)).optional(),
  }).partial().optional(),
}).strict();

export type ContractBody = z.infer<typeof contractBodySchema>;
export type PlanSpec = z.infer<typeof planSpecSchema>;

// ─── Action request / result ────────────────────────────────────────────────

export const actionRequestSchema = z.object({
  actionId: z.string().trim().min(1).max(64).optional(),
  type: z.string().trim().min(1).max(64),
  params: z.record(z.unknown()).default({}),
  requiresApproval: z.boolean().optional(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export type ActionResultStatus = 'OK' | 'FAILED' | 'DENIED' | 'NOT_IMPLEMENTED';
export interface ActionResult {
  actionId: string;
  type: string;
  status: ActionResultStatus;
  evidence?: unknown;
  /** Pre-mutation state captured before a write action (sanitized). */
  preState?: unknown;
  /** Documented rollback path for this action ('none' | description). */
  rollback?: string;
  error?: string;
  at: string;
}
