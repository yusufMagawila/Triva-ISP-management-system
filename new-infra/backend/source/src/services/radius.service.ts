import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';

// Token lifetime: 60 seconds. The Custom Portal Page must exchange the token
// for RADIUS credentials within this window. After that, the token is invalid.
const PORTAL_TOKEN_TTL_SECONDS = 60;

// RADIUS username prefix — makes TRIVA users identifiable in RADIUS logs.
const RADIUS_USERNAME_PREFIX = 'triva_';

/**
 * Generate a cryptographically random RADIUS username.
 * Format: triva_<16 hex chars> = 8 bytes of entropy = 2^64 possibilities.
 */
function generateRadiusUsername(): string {
  return `${RADIUS_USERNAME_PREFIX}${randomBytes(8).toString('hex')}`;
}

/**
 * Generate a cryptographically random RADIUS password.
 * 16 bytes = 128 bits of entropy, hex-encoded = 32 chars.
 */
function generateRadiusPassword(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a cryptographically random Omada portal token.
 * 32 bytes = 256 bits of entropy, base64url-encoded = 43 chars (URL-safe).
 */
function generatePortalToken(): string {
  return randomBytes(32).toString('base64url');
}

export class RadiusService {
  /**
   * Create a RADIUS user for a session.
   * Called after payment is confirmed — the user can then authenticate
   * via the Omada Controller's /portal/radius/auth endpoint.
   *
   * The RADIUS user expires at the same time as the session (plan.durationMins).
   * FreeRADIUS enforces this via the Session-Timeout reply attribute.
   *
   * SECURITY: Passwords are never logged. Only the username is logged.
   */
  async createRadiusUser(
    tenantId: string,
    sessionId: string,
    durationMins: number
  ): Promise<{ username: string; password: string; expiresAt: Date }> {
    const username = generateRadiusUsername();
    const password = generateRadiusPassword();
    const expiresAt = new Date(Date.now() + durationMins * 60 * 1000);

    await prisma.radiusUser.create({
      data: {
        tenantId,
        sessionId,
        username,
        password,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    // Log only the username — never the password.
    logger.info('RADIUS user created', { sessionId, username, expiresAt });

    return { username, password, expiresAt };
  }

  /**
   * Disable a RADIUS user — prevents re-authentication after session expiry.
   * The user remains in the table for auditing but FreeRADIUS will reject
   * any future Access-Request for this username (status != 'ACTIVE').
   *
   * This does NOT disconnect the user from the AP. The AP enforces
   * Session-Timeout and will disconnect when the timeout expires.
   */
  async removeRadiusUser(sessionId: string): Promise<void> {
    await prisma.radiusUser.updateMany({
      where: { sessionId, status: 'ACTIVE' },
      data: { status: 'DISABLED' },
    });

    logger.info('RADIUS user disabled', { sessionId });
  }

  /**
   * Get the RADIUS user associated with a session.
   * Used internally by the omada-credentials endpoint — never exposed
   * via a predictable URL.
   */
  async getRadiusUserBySession(
    sessionId: string
  ): Promise<{ username: string; password: string } | null> {
    const radiusUser = await prisma.radiusUser.findUnique({
      where: { sessionId },
      select: { username: true, password: true, status: true, expiresAt: true },
    });

    if (!radiusUser || radiusUser.status !== 'ACTIVE') {
      return null;
    }

    if (new Date() >= radiusUser.expiresAt) {
      return null;
    }

    return { username: radiusUser.username, password: radiusUser.password };
  }

  /**
   * Create a short-lived, single-use Omada portal token.
   *
   * This token is passed to the Custom Portal Page via URL parameter
   * when TRIVA redirects back to the Omada Controller. The Custom Portal
   * Page then POSTs this token to TRIVA's /api/portal/omada/credentials
   * endpoint to exchange it for RADIUS credentials.
   *
   * SECURITY:
   * - 32 bytes of crypto-random entropy (256 bits) — unguessable.
   * - Expires in 60 seconds.
   * - Single-use — invalidated immediately after consumption.
   * - Token value is never logged.
   *
   * @returns The token string (to be passed as a URL parameter)
   */
  async createOmadaPortalToken(
    tenantId: string,
    sessionId: string
  ): Promise<string> {
    const token = generatePortalToken();
    const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_SECONDS * 1000);

    // Delete any existing token for this session (there should only be one)
    await prisma.omadaPortalToken.deleteMany({
      where: { sessionId },
    }).catch(() => {
      // Ignore if no existing token — deleteMany returns 0 count, not an error
    });

    await prisma.omadaPortalToken.create({
      data: {
        token,
        sessionId,
        tenantId,
        used: false,
        expiresAt,
      },
    });

    // Log only that a token was created — never the token value itself.
    logger.info('Omada portal token created', { sessionId, expiresAt });

    return token;
  }

  /**
   * Consume (validate + invalidate) an Omada portal token.
   *
   * This is called by the POST /api/portal/omada/credentials endpoint.
   * The token is validated against:
   *   1. Exists in the database
   *   2. Not already used (single-use enforcement)
   *   3. Not expired (60-second TTL)
   *
   * If valid, the token is marked as used and the sessionId + tenantId
   * are returned so the caller can look up the RADIUS credentials.
   *
   * If invalid (not found, already used, or expired), returns null.
   *
   * SECURITY: Token value is never logged.
   */
  async consumeOmadaPortalToken(
    token: string
  ): Promise<{ sessionId: string; tenantId: string } | null> {
    // Look up the token
    const portalToken = await prisma.omadaPortalToken.findUnique({
      where: { token },
      select: { id: true, sessionId: true, tenantId: true, used: true, expiresAt: true },
    });

    if (!portalToken) {
      logger.warn('Omada portal token consumption failed: not found');
      return null;
    }

    if (portalToken.used) {
      logger.warn('Omada portal token consumption failed: already used', {
        sessionId: portalToken.sessionId,
      });
      return null;
    }

    if (new Date() >= portalToken.expiresAt) {
      logger.warn('Omada portal token consumption failed: expired', {
        sessionId: portalToken.sessionId,
      });
      return null;
    }

    // Mark as used — single-use enforcement.
    // Use updateMany with the used=false condition to prevent a race condition
    // where two concurrent requests both pass the used check above.
    const result = await prisma.omadaPortalToken.updateMany({
      where: { id: portalToken.id, used: false },
      data: { used: true },
    });

    if (result.count === 0) {
      // Another request consumed the token between our check and update.
      logger.warn('Omada portal token consumption failed: race condition detected', {
        sessionId: portalToken.sessionId,
      });
      return null;
    }

    logger.info('Omada portal token consumed', {
      sessionId: portalToken.sessionId,
    });

    return { sessionId: portalToken.sessionId, tenantId: portalToken.tenantId };
  }
}

export const radiusService = new RadiusService();
