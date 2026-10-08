import { describe, it, expect } from '@jest/globals';
import { validateContract, gateAction, type ActionPolicyContext } from '../policy-validator.service';

const v = (value: unknown, source = 'INSTALLER') => ({ value, source });

const validContract = {
  customer: { businessName: v('Cafe Mlimani') },
  site: { name: v('Mlimani Branch'), profile: v('TRIVA_STANDARD') },
  network: {
    wan: { type: v('DHCP') },
    lan: { subnet: v('192.168.50.0/24'), dhcpPool: v('192.168.50.50-192.168.50.200') },
    firewallProfile: v('TRIVA_BASELINE'),
  },
  wifi: { ssid: v('Mlimani WiFi'), security: v('OPEN_PORTAL') },
  billing: { provider: v('ANYPAY') },
};

describe('validateContract', () => {
  it('accepts a valid contract', () => {
    const out = validateContract(validContract);
    expect(out.errors).toEqual([]);
    expect(out.valid).toBe(true);
  });

  it('rejects non-RFC1918 LAN subnets', () => {
    const out = validateContract({
      ...validContract,
      network: { ...validContract.network, lan: { subnet: v('8.8.8.0/24') } },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('NOT_RFC1918');
  });

  it('rejects LAN subnets overlapping the control-plane range', () => {
    const out = validateContract({
      ...validContract,
      network: { ...validContract.network, lan: { subnet: v('10.251.4.0/24') } },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('SUBNET_CONFLICT');
  });

  it('rejects DHCP pools outside the LAN subnet', () => {
    const out = validateContract({
      ...validContract,
      network: { ...validContract.network, lan: { subnet: v('192.168.50.0/24'), dhcpPool: v('10.0.0.5-10.0.0.9') } },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('POOL_OUTSIDE_SUBNET');
  });

  it('rejects PPPoE without a secretRef', () => {
    const out = validateContract({
      ...validContract,
      network: { wan: { type: v('PPPOE') } },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('MISSING_PPPOE_SECRET');
  });

  it('rejects inline plaintext credentials (must use secretRef)', () => {
    const out = validateContract({
      ...validContract,
      network: { wan: { type: v('PPPOE'), pppoeRef: { secretRef: 'secret://installation/i1/s1' } }, },
      billing: { provider: v('ANYPAY'), apiKey: 'plaintext-key' },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('INLINE_SECRET');
  });

  it('rejects data caps — not enforced by the platform', () => {
    const out = validateContract({
      ...validContract,
      billing: { provider: v('ANYPAY'), plans: v([{ name: '1h', priceTZS: 500, durationMins: 60, dataLimitMb: 500 }]) },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('UNSUPPORTED_FEATURE');
  });

  it('rejects unknown value sources', () => {
    const out = validateContract({ site: { name: { value: 'X', source: 'WIZARD_MAGIC' } } });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('SCHEMA');
  });

  it('rejects identity MISMATCH state inside a contract', () => {
    const out = validateContract({
      ...validContract,
      devices: { mikrotik: { identity: { match: v('MISMATCH') } } },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain('IDENTITY_BLOCKED');
  });
});

describe('gateAction', () => {
  const installation = { id: 'inst-1', tenantId: 'tenant-1', siteId: 'site-1', installerId: 'u1', status: 'IN_PROGRESS' };
  const ctx: ActionPolicyContext = { role: 'INSTALLER', tenantId: 'tenant-1', installation };
  const entry = { type: 'REGISTER_ROUTER', implemented: true };

  it('rejects unknown actions', () => {
    expect(gateAction(undefined, ctx).code).toBe('UNKNOWN_ACTION');
  });

  it('rejects actions for another tenant', () => {
    const r = gateAction(entry, { ...ctx, installation: { ...installation, tenantId: 'tenant-2' } });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SCOPE');
  });

  it('rejects scoped tokens targeting a different installation', () => {
    const r = gateAction(entry, { ...ctx, tokenScope: { installationId: 'inst-999' } });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SCOPE');
  });

  it('rejects actions on terminal installations', () => {
    const r = gateAction(entry, { ...ctx, installation: { ...installation, status: 'COMPLETED' } });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('BAD_STATE');
  });

  it('requires approval for approval-gated actions', () => {
    const gated = { ...entry, requiresApproval: true };
    expect(gateAction(gated, ctx).code).toBe('APPROVAL_REQUIRED');
    expect(gateAction(gated, { ...ctx, approvals: [{ step: 'REGISTER_ROUTER' }] }).allowed).toBe(true);
  });

  it('enforces role allowlists', () => {
    const staffOnly = { ...entry, allowedRoles: ['MERCHANT', 'SUPER_ADMIN'] };
    expect(gateAction(staffOnly, ctx).code).toBe('FORBIDDEN');
  });
});
