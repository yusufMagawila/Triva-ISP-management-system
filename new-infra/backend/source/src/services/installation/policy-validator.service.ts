/**
 * Policy validator — the deterministic layer between ANY proposer
 * (installer wizard today, Gemini later) and the configuration engine.
 *
 * It answers one question: "is this configuration allowed?" Nothing reaches
 * the executor unless this says so. It never executes, never shells out,
 * never talks to a device.
 */

import { z } from 'zod';
import { contractBodySchema, VALUE_SOURCES, CONFIG_PROFILES, type ContractBody } from '../../lib/installation-contract';
import { findInlineSecrets } from '../../lib/sanitize';

const CONTROL_PLANE_RANGE = '10.251.0.0/16';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationOutcome {
  valid: boolean;
  errors: ValidationIssue[];
  /** The contract body with structure verified (values unchanged). */
  contract: ContractBody | null;
}

// ─── Network helpers ─────────────────────────────────────────────────────────

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const baseInt = ipToInt(base);
  const ipInt = ipToInt(ip);
  if (baseInt === null || ipInt === null || isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function cidrsOverlap(a: string, b: string): boolean {
  const [aBase, aBits] = a.split('/');
  const aInt = ipToInt(aBase);
  if (aInt === null) return false;
  return cidrContains(b, aBase) || cidrContains(a, b.split('/')[0]);
}

function isRfc1918(cidr: string): boolean {
  const ip = cidr.split('/')[0];
  return cidrContains('10.0.0.0/8', ip) || cidrContains('172.16.0.0/12', ip) || cidrContains('192.168.0.0/16', ip);
}

// ─── Validator ───────────────────────────────────────────────────────────────

export function validateContract(raw: unknown): ValidationOutcome {
  const errors: ValidationIssue[] = [];
  const push = (path: string, code: string, message: string) => errors.push({ path, code, message });

  // 1. Structural validation
  const parsed = contractBodySchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      push(issue.path.join('.') || '(root)', 'SCHEMA', issue.message);
    }
    return { valid: false, errors, contract: null };
  }
  const c = parsed.data;

  // 2. No inline plaintext secrets anywhere in the RAW contract — zod strips
  //    unknown keys silently, so scanning the parsed copy would miss secrets
  //    hiding in non-schema positions.
  for (const path of findInlineSecrets(raw)) {
    push(path, 'INLINE_SECRET', 'Plaintext credentials are forbidden — use a secretRef');
  }

  // 3. Source vocabulary sanity (defensive — enum already enforced)
  walkValued(c, (path, node) => {
    if (node.source && !(VALUE_SOURCES as readonly string[]).includes(node.source)) {
      push(path, 'BAD_SOURCE', `Unknown value source '${node.source}'`);
    }
  });

  // 4. LAN policy
  const lanSubnet = c.network?.lan?.subnet?.value;
  if (lanSubnet) {
    if (!isRfc1918(lanSubnet)) push('network.lan.subnet', 'NOT_RFC1918', 'LAN subnet must be private (RFC1918)');
    const bits = parseInt(lanSubnet.split('/')[1], 10);
    if (bits < 16) push('network.lan.subnet', 'SUBNET_TOO_LARGE', 'LAN subnet must be /16 or smaller');
    if (cidrsOverlap(lanSubnet, CONTROL_PLANE_RANGE)) {
      push('network.lan.subnet', 'SUBNET_CONFLICT', `Overlaps reserved control-plane range ${CONTROL_PLANE_RANGE}`);
    }
    const pool = c.network?.lan?.dhcpPool?.value;
    if (pool) {
      const [from, to] = pool.split('-');
      if (!cidrContains(lanSubnet, from) || !cidrContains(lanSubnet, to)) {
        push('network.lan.dhcpPool', 'POOL_OUTSIDE_SUBNET', 'DHCP pool must lie inside the LAN subnet');
      } else {
        const f = ipToInt(from)!; const t = ipToInt(to)!;
        if (f > t) push('network.lan.dhcpPool', 'POOL_INVERTED', 'DHCP pool start must precede end');
      }
    }
  }

  // 5. WAN policy
  const wan = c.network?.wan;
  if (wan?.type?.value === 'STATIC' && !wan.static?.value) {
    push('network.wan.static', 'MISSING_STATIC', 'STATIC WAN requires ip/gateway/dns');
  }
  if (wan?.type?.value === 'PPPOE' && !wan.pppoeRef) {
    push('network.wan.pppoeRef', 'MISSING_PPPOE_SECRET', 'PPPoE requires a secretRef (never inline credentials)');
  }

  // 6. WiFi / portal policy — captive portal model is mandatory
  if (c.wifi?.security?.value && c.wifi.security.value !== 'OPEN_PORTAL') {
    push('wifi.security', 'UNSUPPORTED_SECURITY', 'Only OPEN_PORTAL (captive portal) is supported');
  }

  // 7. Profile whitelist
  const profile = c.site?.profile?.value;
  if (profile && !CONFIG_PROFILES.includes(profile)) {
    push('site.profile', 'UNKNOWN_PROFILE', `Profile must be one of ${CONFIG_PROFILES.join(', ')}`);
  }

  // 8. Billing plans — data caps are not enforced by the platform (P2-5);
  //    a contract that depends on them is misleading, so flag it.
  const plans = c.billing?.plans?.value;
  if (plans) {
    plans.forEach((p, i) => {
      if (p.dataLimitMb != null) {
        push(`billing.plans[${i}].dataLimitMb`, 'UNSUPPORTED_FEATURE', 'Data caps are not enforced by the platform — remove or treat as advisory');
      }
    });
  }

  // 9. Device identity consistency — scanned claims must not conflict with
  //    reported evidence inside the same contract (cross-asset checks happen
  //    in the claim action).
  const mk = c.devices?.mikrotik?.identity;
  if (mk?.match?.value === 'MISMATCH' || mk?.match?.value === 'ALREADY_OWNED') {
    push('devices.mikrotik.identity.match', 'IDENTITY_BLOCKED', `Identity state ${mk.match.value} blocks configuration`);
  }

  return { valid: errors.length === 0, errors, contract: c };
}

// ─── Action-level validation ────────────────────────────────────────────────

export interface ActionPolicyContext {
  role: string;
  tenantId: string;
  /** Installation-scoped token restrictions (absent = unscoped user JWT). */
  tokenScope?: { installationId?: string | null; siteId?: string | null };
  /** Resolved installation the action targets. */
  installation: { id: string; tenantId: string; siteId: string; installerId: string; status: string };
  approvals?: Array<{ step: string }> | null;
}

export interface ActionGateResult {
  allowed: boolean;
  error?: string;
  code?: 'UNKNOWN_ACTION' | 'FORBIDDEN' | 'SCOPE' | 'APPROVAL_REQUIRED' | 'BAD_PARAMS' | 'BAD_STATE';
}

/** Allowed installer/merchant/admin action execution roles. */
const ACTION_ROLES = new Set(['INSTALLER', 'MERCHANT', 'SUPER_ADMIN']);

/**
 * Gate a single action request. `registryEntry` comes from the executor's
 * closed vocabulary — anything not in the registry is UNKNOWN_ACTION.
 */
export function gateAction(
  entry: { type: string; implemented: boolean; requiresApproval?: boolean; allowedRoles?: string[] } | undefined,
  ctx: ActionPolicyContext
): ActionGateResult {
  if (!entry) return { allowed: false, error: 'Unknown action type', code: 'UNKNOWN_ACTION' };

  const roles = entry.allowedRoles ?? [...ACTION_ROLES];
  if (!roles.includes(ctx.role)) {
    return { allowed: false, error: `Role ${ctx.role} may not run ${entry.type}`, code: 'FORBIDDEN' };
  }

  if (ctx.installation.tenantId !== ctx.tenantId) {
    return { allowed: false, error: 'Installation belongs to a different tenant', code: 'SCOPE' };
  }
  if (ctx.tokenScope?.installationId && ctx.tokenScope.installationId !== ctx.installation.id) {
    return { allowed: false, error: 'Token is scoped to a different installation', code: 'SCOPE' };
  }
  if (ctx.tokenScope?.siteId && ctx.tokenScope.siteId !== ctx.installation.siteId) {
    return { allowed: false, error: 'Token is scoped to a different site', code: 'SCOPE' };
  }

  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
  if (terminal.includes(ctx.installation.status)) {
    return { allowed: false, error: `Installation is ${ctx.installation.status} — no further actions`, code: 'BAD_STATE' };
  }

  if (entry.requiresApproval) {
    const ok = (ctx.approvals ?? []).some((a) => a.step === entry.type || a.step === '*');
    if (!ok) return { allowed: false, error: `Action ${entry.type} requires an approval`, code: 'APPROVAL_REQUIRED' };
  }

  return { allowed: true };
}

/** Walk every {value,source,state} node in a contract body. */
function walkValued(
  node: unknown,
  fn: (path: string, node: { value: unknown; source?: string; state?: string }) => void,
  path = ''
): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkValued(v, fn, `${path}[${i}]`));
    return;
  }
  const obj = node as Record<string, unknown>;
  if ('value' in obj && (obj.value === null || typeof obj.value !== 'object' || Array.isArray(obj.value))) {
    fn(path, obj as { value: unknown; source?: string; state?: string });
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    walkValued(v, fn, path ? `${path}.${k}` : k);
  }
}

export const __testables = { cidrContains, cidrsOverlap, isRfc1918, ipToInt, CONTROL_PLANE_RANGE };
