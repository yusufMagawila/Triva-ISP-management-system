/**
 * Deterministic device identity matching — the rule the whole Copilot flow
 * depends on:
 *
 *   scanned value  = CLAIM (what the installer asserts is in their hand)
 *   reported value = EVIDENCE (what the device itself reported at bootstrap)
 *
 * A device is claimable only when claim and evidence agree (or when a
 * previously-bound asset row already carries the reported identity).
 */

import { normalizeRouterMac, normalizeRouterSerial } from '../router-provisioning.service';

export type IdentityMatch = 'UNMATCHED' | 'MATCHED' | 'MISMATCH' | 'ALREADY_OWNED' | 'NOT_FOUND';

export interface IdentityClaim {
  serialNumber?: string;
  macAddress?: string;
}

export interface DeviceIdentityRecord {
  id: string;
  tenantId: string;
  serialNumber: string | null;
  hardwareMac: string | null;
  siteId?: string | null;
}

export function matchIdentity(
  asset: DeviceIdentityRecord,
  claim: IdentityClaim,
  ctx: { tenantId: string; siteId: string }
): { match: IdentityMatch; normalizedClaim: IdentityClaim } {
  const normalizedClaim: IdentityClaim = {
    serialNumber: normalizeRouterSerial(claim.serialNumber),
    macAddress: normalizeRouterMac(claim.macAddress),
  };

  // Ownership boundary first — an installer must never "claim" another
  // tenant's hardware, and a device bound to a different site cannot be
  // silently re-stolen.
  if (asset.tenantId !== ctx.tenantId) {
    return { match: 'ALREADY_OWNED', normalizedClaim };
  }
  if (asset.siteId && asset.siteId !== ctx.siteId) {
    return { match: 'ALREADY_OWNED', normalizedClaim };
  }

  const claimMac = normalizedClaim.macAddress;
  const claimSerial = normalizedClaim.serialNumber;

  if (!claimMac && !claimSerial) return { match: 'UNMATCHED', normalizedClaim };

  // If the asset carries a bound identity, the claim must agree with it.
  if (claimMac && asset.hardwareMac && asset.hardwareMac !== claimMac) {
    return { match: 'MISMATCH', normalizedClaim };
  }
  if (claimSerial && asset.serialNumber && asset.serialNumber !== claimSerial) {
    return { match: 'MISMATCH', normalizedClaim };
  }

  // At least one claimed identifier must actually match a bound identifier
  // (or the asset has no bound identity yet, i.e. first binding).
  const macOk = claimMac ? !asset.hardwareMac || asset.hardwareMac === claimMac : true;
  const serialOk = claimSerial ? !asset.serialNumber || asset.serialNumber === claimSerial : true;
  const boundSomething =
    (claimMac && asset.hardwareMac === claimMac) ||
    (claimSerial && asset.serialNumber === claimSerial) ||
    (!asset.hardwareMac && !asset.serialNumber);

  if (macOk && serialOk && boundSomething) return { match: 'MATCHED', normalizedClaim };
  return { match: 'UNMATCHED', normalizedClaim };
}
