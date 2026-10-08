import { describe, it, expect } from '@jest/globals';
import { sanitizeSecrets, findInlineSecrets } from '../sanitize';

describe('sanitizeSecrets', () => {
  it('redacts credential-looking string fields', () => {
    const out = sanitizeSecrets({
      name: 'Site A',
      password: 'hunter2',
      apiKey: 'ak_live_123',
      radiusSecret: 's3cret',
      nested: { token: 'tok', passwordEnc: 'enc:…', safe: 'ok' },
    }) as Record<string, unknown>;
    expect(out.name).toBe('Site A');
    expect(out.password).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.radiusSecret).toBe('[redacted]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.token).toBe('[redacted]');
    expect(nested.passwordEnc).toBe('[redacted]');
    expect(nested.safe).toBe('ok');
  });

  it('collapses secretRef nodes to reference + presence flag', () => {
    const out = sanitizeSecrets({
      pppoeRef: { secretRef: 'secret://installation/inst1/s1', password: 'SHOULD-NOT-LEAK' },
    }) as { pppoeRef: Record<string, unknown> };
    expect(out.pppoeRef.secretRef).toBe('secret://installation/inst1/s1');
    expect(out.pppoeRef.present).toBe(true);
    expect(out.pppoeRef.password).toBeUndefined();
  });

  it('does not redact safe identifier keys', () => {
    const out = sanitizeSecrets({ idempotencyKey: 'abc-123', publicKey: 'pk' }) as Record<string, unknown>;
    expect(out.idempotencyKey).toBe('abc-123');
    expect(out.publicKey).toBe('pk');
  });

  it('recurses into arrays', () => {
    const out = sanitizeSecrets({ items: [{ apiKey: 'x' }] }) as { items: Array<{ apiKey: string }> };
    expect(out.items[0].apiKey).toBe('[redacted]');
  });
});

describe('findInlineSecrets', () => {
  it('finds plaintext at credential-looking paths', () => {
    const hits = findInlineSecrets({
      network: { wan: { pppoe: { password: 'plain' } } },
      devices: [{ apiKey: 'k' }],
    });
    expect(hits).toContain('network.wan.pppoe.password');
    expect(hits).toContain('devices[0].apiKey');
  });

  it('ignores secretRef references', () => {
    expect(findInlineSecrets({ pppoeRef: { secretRef: 'secret://installation/i/s' } })).toHaveLength(0);
  });
});
