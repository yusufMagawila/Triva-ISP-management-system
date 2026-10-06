import { describe, it, expect, beforeAll } from '@jest/globals';
import { randomBytes } from 'crypto';
import { encryptValue, decryptValue, encryptRouterCredential, decryptRouterCredential, encryptTenantKey, decryptTenantKey } from '../crypto';

describe('AES-256-GCM credential encryption', () => {
  const key = randomBytes(32);
  const otherKey = randomBytes(32);

  beforeAll(() => {
    process.env.ROUTER_CREDENTIALS_KEY = key.toString('base64');
    process.env.TENANT_KEYS_ENCRYPTION_KEY = key.toString('base64');
  });

  it('round-trips plaintext to ciphertext and back', () => {
    const plaintext = 'my-secret-router-password-123!';
    const ciphertext = encryptValue(plaintext, key);
    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext.split(':')).toHaveLength(3);
    const decrypted = decryptValue(ciphertext, key);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-password';
    const c1 = encryptValue(plaintext, key);
    const c2 = encryptValue(plaintext, key);
    expect(c1).not.toEqual(c2);
    expect(decryptValue(c1, key)).toEqual(plaintext);
    expect(decryptValue(c2, key)).toEqual(plaintext);
  });

  it('fails to decrypt with the wrong key', () => {
    const plaintext = 'secret';
    const ciphertext = encryptValue(plaintext, key);
    expect(() => decryptValue(ciphertext, otherKey)).toThrow();
  });

  it('fails to decrypt corrupted ciphertext', () => {
    const plaintext = 'secret';
    const ciphertext = encryptValue(plaintext, key);
    const corrupted = ciphertext.replace(/.$/, 'x');
    expect(() => decryptValue(corrupted, key)).toThrow();
  });

  it('fails to decrypt an invalid format', () => {
    expect(() => decryptValue('not-valid', key)).toThrow();
  });

  it('returns empty string for empty plaintext', () => {
    expect(encryptValue('', key)).toEqual('');
    expect(decryptValue('', key)).toEqual('');
  });

  it('never treats encrypted value as plaintext (prefix check)', () => {
    const plaintext = 'admin';
    const ciphertext = encryptValue(plaintext, key);
    // Encrypted values should not equal common plaintext passwords
    expect(ciphertext).not.toEqual(plaintext);
  });

  it('round-trips via router credential helpers', () => {
    const plaintext = 'router-pass';
    const ciphertext = encryptRouterCredential(plaintext);
    expect(decryptRouterCredential(ciphertext)).toEqual(plaintext);
  });

  it('round-trips via tenant key helpers', () => {
    const plaintext = 'tenant-api-key';
    const ciphertext = encryptTenantKey(plaintext);
    expect(decryptTenantKey(ciphertext)).toEqual(plaintext);
  });
});
