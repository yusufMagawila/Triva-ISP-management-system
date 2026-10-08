import { describe, it, expect } from '@jest/globals';
import { matchIdentity, type DeviceIdentityRecord } from '../identity.service';

const CTX = { tenantId: 'tenant-1', siteId: 'site-1' };

function asset(over: Partial<DeviceIdentityRecord> = {}): DeviceIdentityRecord {
  return {
    id: 'router-1',
    tenantId: 'tenant-1',
    serialNumber: null,
    hardwareMac: null,
    siteId: null,
    ...over,
  };
}

describe('matchIdentity', () => {
  it('rejects assets owned by another tenant', () => {
    const r = matchIdentity(asset({ tenantId: 'tenant-2' }), { serialNumber: 'ABC123' }, CTX);
    expect(r.match).toBe('ALREADY_OWNED');
  });

  it('rejects assets bound to another site', () => {
    const r = matchIdentity(asset({ siteId: 'site-9' }), { serialNumber: 'ABC123' }, CTX);
    expect(r.match).toBe('ALREADY_OWNED');
  });

  it('matches a claim against bound serial + MAC', () => {
    const r = matchIdentity(
      asset({ serialNumber: 'SN1234', hardwareMac: 'aa:bb:cc:dd:ee:ff' }),
      { serialNumber: 'sn1234', macAddress: 'AA-BB-CC-DD-EE-FF' },
      CTX
    );
    expect(r.match).toBe('MATCHED');
    expect(r.normalizedClaim.serialNumber).toBe('SN1234');
    expect(r.normalizedClaim.macAddress).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('blocks installation on identity mismatch', () => {
    const r = matchIdentity(
      asset({ serialNumber: 'SN1234', hardwareMac: 'aa:bb:cc:dd:ee:ff' }),
      { serialNumber: 'DIFFERENT', macAddress: 'aa:bb:cc:dd:ee:ff' },
      CTX
    );
    expect(r.match).toBe('MISMATCH');
  });

  it('returns UNMATCHED when no claim evidence exists', () => {
    const r = matchIdentity(asset({ serialNumber: 'SN1234' }), {}, CTX);
    expect(r.match).toBe('UNMATCHED');
  });

  it('allows first binding when asset has no identity yet', () => {
    const r = matchIdentity(asset(), { serialNumber: 'SN9999' }, CTX);
    expect(r.match).toBe('MATCHED');
  });
});
