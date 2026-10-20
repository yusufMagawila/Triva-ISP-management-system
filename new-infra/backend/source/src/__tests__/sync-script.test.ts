import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../config/prisma', () => ({ prisma: {} }));
jest.mock('../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../services/session.service', () => ({ sessionService: {} }));

import { buildBootstrapSyncScript } from '../controllers/bootstrap.controller';
import { isValidSsid } from '../lib/wifi';

const ROUTER = { id: 'r1', name: 'Lab', hotspotName: 'hotspot1', provisioningKey: 'key-1' };
const session = (id: string, down: number | null = 5000) => ({
  id, macAddress: 'AA:BB:CC:DD:EE:FF', hotspotUsername: `u_${id}`, hotspotPassword: 'pw123456789',
  plan: { id: 'plan12345678', durationMins: 60, downloadKbps: down, uploadKbps: down },
});

describe('buildBootstrapSyncScript — RouterOS 6 compatibility guards', () => {
  const script = buildBootstrapSyncScript(ROUTER, [session('s1'), session('s2')], [], null);

  it('never uses the RouterOS 7-only "user/profile" path', () => {
    expect(script).not.toContain('user/profile');
    expect(script).toContain('/ip hotspot user profile');
  });

  it('never declares a :local inside the per-session loop', () => {
    expect(script).not.toContain(':local ackUrl');
    const afterHeader = script.split('# Pending removals')[1] ?? '';
    const perSession = afterHeader.slice(afterHeader.indexOf('/ip hotspot user'));
    expect(perSession).not.toMatch(/:local /);
  });

  it('acks each session only inside its user-add block', () => {
    const blocks = script.split(':do {').slice(1);
    const sessionBlocks = blocks.filter((b) => b.includes('/ack/'));
    expect(sessionBlocks.length).toBe(2);
    for (const b of sessionBlocks) {
      expect(b.indexOf('/ip hotspot user add')).toBeLessThan(b.indexOf('/ack/'));
    }
  });

  it('refreshes login, alogin and status pages', () => {
    for (const page of ['login.html', 'alogin.html', 'status.html']) expect(script).toContain(`/${page}"`);
  });

  it('has balanced braces', () => {
    const open = (script.match(/\{/g) ?? []).length;
    const close = (script.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});

describe('WiFi name in the sync script', () => {
  it('is omitted when there is nothing to apply', () => {
    expect(buildBootstrapSyncScript(ROUTER, [], [], null)).not.toContain('/interface wireless');
  });

  it('is applied and acknowledged only after the change succeeds', () => {
    const s = buildBootstrapSyncScript(ROUTER, [], [], 'Baraka WiFi');
    expect(s).toContain('ssid="Baraka WiFi"');
    expect(s.indexOf('/interface wireless set')).toBeLessThan(s.indexOf('/wifi-ack'));
  });

  it('refuses to emit a name that could break out of the string', () => {
    for (const bad of ['a"; /system reset-configuration; "', 'x$(y)', 'a\\b', '[evil]', '']) {
      const s = buildBootstrapSyncScript(ROUTER, [], [], bad);
      expect(s).not.toContain('/interface wireless');
      expect(s).not.toContain('reset-configuration');
    }
  });
});

describe('isValidSsid', () => {
  it('accepts normal names', () => {
    for (const ok of ['Baraka WiFi', 'Cafe-1', 'Neema_Shop.2', 'A']) expect(isValidSsid(ok)).toBe(true);
  });
  it('rejects empty, too long, and unsafe names', () => {
    for (const bad of ['', ' lead', 'x'.repeat(33), 'a"b', 'a$b', 'a\\b', 'a[b]', 'a;b', 'é-cafe', 42, null]) {
      expect(isValidSsid(bad)).toBe(false);
    }
  });
});
