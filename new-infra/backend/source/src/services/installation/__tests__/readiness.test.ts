import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const prismaMock = {
  router: { findFirst: jest.fn() },
  tenant: { findUnique: jest.fn() },
  plan: { count: jest.fn() },
};

jest.mock('../../../config/prisma', () => ({ prisma: prismaMock }));
jest.mock('../../../config/env', () => ({ env: { APP_URL: 'https://api.example.com' } }));

import { computeReadiness, getBootstrapCommand } from '../readiness.service';

const GOOD_TENANT = {
  status: 'ACTIVE', portalNoticeName: 'Baraka Cafe', anypayEnabled: true,
  anypayApiKeyEnc: 'enc', anypayApiKey: null, subscription: null,
};
const ONLINE_ROUTER = { id: 'r1', name: 'Lab', lastSeenAt: new Date(), provisioningKey: 'key-1', wifiSsid: 'Baraka', wifiSsidApplied: 'Baraka' };

const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.router.findFirst.mockResolvedValue(ONLINE_ROUTER as never);
  prismaMock.tenant.findUnique.mockResolvedValue(GOOD_TENANT as never);
  prismaMock.plan.count.mockResolvedValue(2 as never);
  global.fetch = jest.fn(async () => ({ ok: true })) as never;
});
afterEach(() => { global.fetch = realFetch; });

const status = (r: Awaited<ReturnType<typeof computeReadiness>>, key: string) =>
  r.checks.find((c) => c.key === key)?.status;

describe('computeReadiness', () => {
  it('is ready when everything passes', async () => {
    const r = await computeReadiness('t1', 's1');
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails when no router is registered for the site', async () => {
    prismaMock.router.findFirst.mockResolvedValue(null as never);
    const r = await computeReadiness('t1', 's1');
    expect(r.ready).toBe(false);
    expect(status(r, 'router')).toBe('fail');
  });

  it('fails when the heartbeat is stale', async () => {
    prismaMock.router.findFirst.mockResolvedValue({ ...ONLINE_ROUTER, lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) } as never);
    const r = await computeReadiness('t1', 's1');
    expect(status(r, 'online')).toBe('fail');
    expect(r.ready).toBe(false);
  });

  it('fails when the router has never been seen', async () => {
    prismaMock.router.findFirst.mockResolvedValue({ ...ONLINE_ROUTER, lastSeenAt: null } as never);
    expect(status(await computeReadiness('t1', 's1'), 'online')).toBe('fail');
  });

  it('fails when the tenant is not active or the subscription expired', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ ...GOOD_TENANT, status: 'PENDING' } as never);
    expect(status(await computeReadiness('t1', 's1'), 'tenant')).toBe('fail');
    prismaMock.tenant.findUnique.mockResolvedValue({
      ...GOOD_TENANT, subscription: { status: 'EXPIRED', expiresAt: new Date(0) },
    } as never);
    expect(status(await computeReadiness('t1', 's1'), 'tenant')).toBe('fail');
  });

  it('fails without a shop name or packages', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ ...GOOD_TENANT, portalNoticeName: ' ' } as never);
    prismaMock.plan.count.mockResolvedValue(0 as never);
    const r = await computeReadiness('t1', 's1');
    expect(status(r, 'branding')).toBe('fail');
    expect(status(r, 'plans')).toBe('fail');
  });

  it('only warns (does not block) when payments are not connected', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ ...GOOD_TENANT, anypayApiKeyEnc: null } as never);
    const r = await computeReadiness('t1', 's1');
    expect(status(r, 'payments')).toBe('warn');
    expect(r.ready).toBe(true);
  });

  it('fails when the portal API does not serve the router', async () => {
    global.fetch = jest.fn(async () => ({ ok: false })) as never;
    const r = await computeReadiness('t1', 's1');
    expect(status(r, 'portal')).toBe('fail');
    global.fetch = jest.fn(async () => { throw new Error('timeout'); }) as never;
    expect(status(await computeReadiness('t1', 's1'), 'portal')).toBe('fail');
  });
});

describe('getBootstrapCommand', () => {
  it('returns the two-line fetch + import command', async () => {
    const { routerId, commands } = await getBootstrapCommand('t1', 's1');
    expect(routerId).toBe('r1');
    expect(commands).toContain('/tool fetch mode=https url="https://api.example.com/bootstrap/router/key-1"');
    expect(commands).toContain('/import file-name="triva-bootstrap.rsc"');
  });

  it('returns nothing when the site has no router', async () => {
    prismaMock.router.findFirst.mockResolvedValue(null as never);
    expect(await getBootstrapCommand('t1', 's1')).toEqual({ routerId: null, commands: null });
  });
});

describe('wifi readiness line', () => {
  it('warns (does not block) when the name is queued or unset', async () => {
    prismaMock.router.findFirst.mockResolvedValue({ ...ONLINE_ROUTER, wifiSsidApplied: null } as never);
    let r = await computeReadiness('t1', 's1');
    expect(r.checks.find((c) => c.key === 'wifi')?.status).toBe('warn');
    expect(r.ready).toBe(true);
    prismaMock.router.findFirst.mockResolvedValue({ ...ONLINE_ROUTER, wifiSsid: null, wifiSsidApplied: null } as never);
    r = await computeReadiness('t1', 's1');
    expect(r.checks.find((c) => c.key === 'wifi')?.status).toBe('warn');
  });
});
