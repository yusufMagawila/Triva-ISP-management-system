import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { decryptRouterCredential } from '../lib/crypto';

type RouterSyncTokenSource = {
  id: string;
  passwordHash: string;
  passwordEnc?: string | null;
  updatedAt: Date;
};

function resolvePassword(router: RouterSyncTokenSource): string {
  return router.passwordEnc ? decryptRouterCredential(router.passwordEnc) : router.passwordHash;
}

export function buildRouterSyncToken(router: RouterSyncTokenSource): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`${router.id}:${router.updatedAt.toISOString()}:${resolvePassword(router)}`)
    .digest('hex');
}

export function verifyRouterSyncToken(router: RouterSyncTokenSource, token: string | undefined): boolean {
  if (!token) return false;

  const expected = buildRouterSyncToken(router);
  const providedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}