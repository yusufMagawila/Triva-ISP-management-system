import { describe, it, expect } from '@jest/globals';
import { createMikroTikService, MikroTikService } from '../services/mikrotik.service';
import { createTpLinkService, TpLinkService } from '../services/tplink.service';
import { randomBytes } from 'crypto';
import { encryptRouterCredential } from '../lib/crypto';

describe('Router credential handling', () => {
  const key = randomBytes(32).toString('base64');
  beforeAll(() => { process.env.ROUTER_CREDENTIALS_KEY = key; });

  it('createMikroTikService falls back to passwordHash when passwordEnc is absent', () => {
    const service = createMikroTikService({
      ipAddress: '192.168.1.1',
      apiPort: 8728,
      username: 'admin',
      passwordHash: 'plain-password',
      passwordEnc: null,
    });
    expect(service).toBeInstanceOf(MikroTikService);
  });

  it('createMikroTikService decrypts passwordEnc when present', () => {
    const encrypted = encryptRouterCredential('secret-password');
    const service = createMikroTikService({
      ipAddress: '192.168.1.1',
      apiPort: 8728,
      username: 'admin',
      passwordHash: 'legacy',
      passwordEnc: encrypted,
    });
    expect(service).toBeInstanceOf(MikroTikService);
  });

  it('createTpLinkService decrypts passwordEnc when present', () => {
    const encrypted = encryptRouterCredential('tplink-secret');
    const service = createTpLinkService({
      ipAddress: '192.168.1.2',
      sshPort: 22,
      username: 'root',
      passwordHash: 'legacy',
      passwordEnc: encrypted,
    });
    expect(service).toBeInstanceOf(TpLinkService);
  });
});
