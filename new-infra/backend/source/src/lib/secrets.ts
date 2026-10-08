/**
 * Secret references — Phase 5A secret management.
 *
 * Installer-supplied secrets (PPPoE credentials, Omada controller password,
 * device admin passwords) are never stored in configuration JSON. They are
 * encrypted into `installation_secrets` and referenced by URI:
 *
 *   secret://installation/<installationId>/<secretId>
 *
 * Only the configuration engine resolves a ref — resolution happens inside
 * this module at execution time, and the plaintext never leaves the backend.
 */

import { prisma } from '../config/prisma';
import { encryptRouterCredential, decryptRouterCredential } from './crypto';

export const SECRET_REF_PATTERN = /^secret:\/\/installation\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;

export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && SECRET_REF_PATTERN.test(value);
}

export function buildSecretRef(installationId: string, secretId: string): string {
  return `secret://installation/${installationId}/${secretId}`;
}

export function parseSecretRef(ref: string): { installationId: string; secretId: string } | null {
  const m = SECRET_REF_PATTERN.exec(ref);
  return m ? { installationId: m[1], secretId: m[2] } : null;
}

/**
 * Store a plaintext secret for an installation. Returns the secretRef.
 * The plaintext is encrypted at rest and is never returned.
 */
export async function storeInstallationSecret(
  installationId: string,
  kind: string,
  plaintext: string,
  label?: string
): Promise<{ secretRef: string; secretId: string }> {
  const row = await prisma.installationSecret.create({
    data: {
      installationId,
      kind,
      label: label ?? null,
      valueEnc: encryptRouterCredential(plaintext),
    },
    select: { id: true },
  });
  return { secretRef: buildSecretRef(installationId, row.id), secretId: row.id };
}

/**
 * Resolve a secretRef to plaintext. Only callable inside the backend —
 * the configuration engine calls this at execution time.
 * Throws if the ref does not belong to the claimed installation.
 */
export async function resolveSecretRef(ref: string, expectedInstallationId?: string): Promise<string> {
  const parsed = parseSecretRef(ref);
  if (!parsed) throw new Error('Invalid secretRef format');
  if (expectedInstallationId && parsed.installationId !== expectedInstallationId) {
    throw new Error('secretRef belongs to a different installation');
  }

  const row = await prisma.installationSecret.findUnique({
    where: { id: parsed.secretId },
    select: { installationId: true, valueEnc: true },
  });
  if (!row || row.installationId !== parsed.installationId) {
    throw new Error('secretRef not found');
  }
  return decryptRouterCredential(row.valueEnc);
}

/** Mark a secret as consumed (used by the executor). */
export async function markSecretConsumed(secretId: string): Promise<void> {
  await prisma.installationSecret.update({
    where: { id: secretId },
    data: { consumedAt: new Date() },
  });
}
