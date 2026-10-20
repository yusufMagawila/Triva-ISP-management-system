import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../config/prisma', () => ({ prisma: {} }));

import { buildRouterBootstrapScript } from '../services/router-provisioning.service';

const ROUTER = {
  id: 'r1', name: 'Lab', ipAddress: '10.251.0.10', apiPort: 8728, username: 'triva-agent',
  passwordHash: 'plain-test-pw', passwordEnc: null, hotspotName: 'hotspot1',
  provisioningKey: 'key-1', updatedAt: new Date(),
};

describe('buildRouterBootstrapScript', () => {
  const script = buildRouterBootstrapScript(ROUTER, 'https://api.example.com');

  it('creates a hotspot only when none exists at all', () => {
    expect(script).toContain(':if ([:len [/ip hotspot find]] = 0) do={');
    expect(script).toContain('/ip hotspot add name=$trivaHotspotName');
  });

  it('creates the hotspot before the profile/login settings are applied', () => {
    expect(script.indexOf('/ip hotspot add name=$trivaHotspotName'))
      .toBeLessThan(script.indexOf('/ip hotspot profile set [find where name=$trivaHotspotProfile]'));
  });

  it('never uses RouterOS 7-only slash paths', () => {
    expect(script).not.toContain('user/profile');
  });

  it('has balanced braces and brackets', () => {
    const count = (re: RegExp) => (script.match(re) ?? []).length;
    expect(count(/\{/g)).toBe(count(/\}/g));
    expect(count(/\[/g)).toBe(count(/\]/g));
  });

  it('keeps the walled garden for the portal and payment hosts', () => {
    expect(script).toContain('dst-host="*.trivaconnect.site"');
  });
});
