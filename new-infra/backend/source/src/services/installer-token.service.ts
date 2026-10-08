/**
 * Scoped installer tokens — revocable, short-lived credentials for physical
 * installation work.
 *
 * A normal login JWT proves WHO the installer is. An InstallerToken proves
 * WHAT they may touch: one tenant, optionally one installation/site. Tokens
 * are recorded by jti so they can be revoked and audited.
 *
 * Threat model:
 *  - Device stolen / token copied → revoke by jti; tokens expire (default 8h).
 *  - Token replayed outside its installation → scope mismatch rejected by the
 *    action gate (tokenScope check in the policy validator).
 *  - Installer account disabled → authenticate() already checks isActive via
 *    login; scoped tokens additionally re-check the DB row on verify.
 *  - No secrets in tokens: claims carry IDs only, never credentials.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import type { AuthPayload } from '../types';

const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours — one workday on site

export interface ScopedTokenClaims extends AuthPayload {
  scope: 'install';
  jti: string;
  installationId?: string | null;
  siteId?: string | null;
  scopes: string[];
}

export async function issueInstallerToken(params: {
  installerId: string;
  tenantId: string;
  installationId?: string;
  siteId?: string;
  scopes?: string[];
  ttlSeconds?: number;
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomBytes(16).toString('base64url');
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const scopes = params.scopes ?? ['install:read', 'install:write', 'install:execute'];

  await prisma.installerToken.create({
    data: {
      jti,
      installerId: params.installerId,
      tenantId: params.tenantId,
      installationId: params.installationId ?? null,
      siteId: params.siteId ?? null,
      scopes,
      expiresAt,
    },
  });

  const claims: ScopedTokenClaims & { sub: string } = {
    sub: params.installerId,
    userId: params.installerId,
    tenantId: params.tenantId,
    role: 'INSTALLER',
    email: '',
    scope: 'install',
    jti,
    installationId: params.installationId ?? null,
    siteId: params.siteId ?? null,
    scopes,
  };

  const token = jwt.sign(claims, env.JWT_SECRET, { expiresIn: ttl });
  return { token, jti, expiresAt };
}

/**
 * Verify a scoped token's DB state (revocation + expiry + installer active).
 * Called by middleware when a request presents scope='install'.
 */
export async function verifyScopedToken(claims: ScopedTokenClaims): Promise<{ ok: boolean; reason?: string }> {
  if (!claims.jti) return { ok: false, reason: 'Missing token id' };

  const row = await prisma.installerToken.findUnique({
    where: { jti: claims.jti },
    include: { installer: { select: { isActive: true, role: true, tenantId: true } } },
  });
  if (!row) return { ok: false, reason: 'Unknown token' };
  if (row.revokedAt) return { ok: false, reason: 'Token revoked' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'Token expired' };
  if (!row.installer.isActive) return { ok: false, reason: 'Installer account disabled' };
  if (row.installer.tenantId !== claims.tenantId) return { ok: false, reason: 'Token tenant mismatch' };

  return { ok: true };
}

export async function revokeInstallerToken(jti: string, tenantId?: string): Promise<boolean> {
  const row = await prisma.installerToken.findUnique({ where: { jti } });
  if (!row) return false;
  if (tenantId && row.tenantId !== tenantId) return false;
  await prisma.installerToken.update({
    where: { jti },
    data: { revokedAt: new Date() },
  });
  return true;
}
