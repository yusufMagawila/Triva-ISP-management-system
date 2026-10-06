/**
 * Authenticated symmetric encryption for reversible secrets.
 *
 * Use cases:
 * - Router passwords (MikroTik, TP-Link) that the app must know in plain text.
 * - Tenant payment API keys (Mongike, AnyPay, ZenoPayMobile).
 * - Omada RADIUS shared secrets.
 *
 * Algorithm: AES-256-GCM with a random 128-bit IV and 128-bit authentication tag.
 * Format:    iv:authTag:ciphertext  (all hex)
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;    // 128 bits
const TAG_LENGTH = 16;   // 128 bits
const KEY_LENGTH = 32;   // 256 bits

function loadKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`Missing encryption key environment variable: ${envName}`);
  }

  // Accept either 32 raw bytes (base64) or 64 hex chars.
  if (raw.length === 64) {
    const key = Buffer.from(raw, 'hex');
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid hex key length for ${envName}: expected 64 hex chars`);
    }
    return key;
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid key length for ${envName}: expected 32 bytes (base64) or 64 hex chars, got ${key.length}`
    );
  }
  return key;
}

/**
 * Derive a 32-byte key from a high-entropy passphrase using scrypt.
 * Prefer providing the key directly in env; this is a fallback for local dev.
 */
export function deriveKey(passphrase: string, salt: string): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

export function encryptValue(plaintext: string, key: Buffer): string {
  if (!plaintext) return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptValue(ciphertext: string, key: Buffer): string {
  if (!ciphertext) return '';
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// Convenience helpers tied to environment keys.
export function encryptRouterCredential(plaintext: string): string {
  return encryptValue(plaintext, loadKey('ROUTER_CREDENTIALS_KEY'));
}

export function decryptRouterCredential(ciphertext: string): string {
  return decryptValue(ciphertext, loadKey('ROUTER_CREDENTIALS_KEY'));
}

export function encryptTenantKey(plaintext: string): string {
  return encryptValue(plaintext, loadKey('TENANT_KEYS_ENCRYPTION_KEY'));
}

export function decryptTenantKey(ciphertext: string): string {
  return decryptValue(ciphertext, loadKey('TENANT_KEYS_ENCRYPTION_KEY'));
}
