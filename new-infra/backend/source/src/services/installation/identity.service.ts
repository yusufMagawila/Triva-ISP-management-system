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

  // Normalize the stored side too — RouterOS reports uppercase MACs and legacy
  // rows were written before normalization existed. Without this, a bound
  // asset would false-MISMATCH against its own real identity.
  const assetMac = normalizeRouterMac(asset.hardwareMac) ?? null;
  const assetSerial = normalizeRouterSerial(asset.serialNumber) ?? null;

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
  if (claimMac && assetMac && assetMac !== claimMac) {
    return { match: 'MISMATCH', normalizedClaim };
  }
  if (claimSerial && assetSerial && assetSerial !== claimSerial) {
    return { match: 'MISMATCH', normalizedClaim };
  }

  // At least one claimed identifier must actually match a bound identifier
  // (or the asset has no bound identity yet, i.e. first binding).
  const macOk = claimMac ? !assetMac || assetMac === claimMac : true;
  const serialOk = claimSerial ? !assetSerial || assetSerial === claimSerial : true;
  const boundSomething =
    (claimMac && assetMac === claimMac) ||
    (claimSerial && assetSerial === claimSerial) ||
    (!assetMac && !assetSerial);

  if (macOk && serialOk && boundSomething) return { match: 'MATCHED', normalizedClaim };
  return { match: 'UNMATCHED', normalizedClaim };
}
