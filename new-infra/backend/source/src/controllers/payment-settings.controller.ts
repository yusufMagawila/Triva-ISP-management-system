import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { encryptTenantKey, decryptTenantKey } from '../lib/crypto';
import {
  AnypayGateway,
  ANYPAY_DEFAULT_BASE_URL,
  parseAnypayCredentialBundle,
} from '../services/gateways/anypay.gateway';

function maskSecret(value: string): string | null {
  if (!value) return null;
  return `••••••••${value.slice(-4)}`;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('Base URL must be a valid URL'), { statusCode: 400 });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Base URL must use https://'), { statusCode: 400 });
  }
  return trimmed.replace(/\/+$/, '');
}

function tenantWebhookUrl(webhookSecret: string | null): string | null {
  if (!webhookSecret) return null;
  return `${env.APP_URL}/api/payments/webhook/anypay/${webhookSecret}`;
}

/**
 * GET /api/payment-settings
 * Returns the tenant's AnyPay configuration. Secrets are never returned —
 * only masked indicators.
 */
export async function getPaymentSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        anypayApiKey: true,
        anypayApiKeyEnc: true,
        anypayBaseUrl: true,
        anypayEnabled: true,
        webhookSecret: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const plain = tenant.anypayApiKeyEnc
      ? decryptTenantKey(tenant.anypayApiKeyEnc)
      : (tenant.anypayApiKey ?? '');
    const creds = parseAnypayCredentialBundle(plain);

    res.json({
      success: true,
      data: {
        provider: 'ANYPAY',
        enabled: tenant.anypayEnabled,
        configured: !!creds.apiKey,
        anypayApiKey: maskSecret(creds.apiKey),
        anypayAccessToken: maskSecret(creds.accessToken),
        anypayBaseUrl: tenant.anypayBaseUrl ?? ANYPAY_DEFAULT_BASE_URL,
        webhookUrl: tenantWebhookUrl(tenant.webhookSecret),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/payment-settings
 * Updates the tenant's AnyPay configuration. Empty secret fields are left
 * unchanged so admins can adjust non-secret settings without re-entering keys.
 */
export async function updatePaymentSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const {
      anypayApiKey,
      anypayAccessToken,
      anypayBaseUrl,
      anypayEnabled,
    } = req.body as {
      anypayApiKey?: string;
      anypayAccessToken?: string;
      anypayBaseUrl?: string;
      anypayEnabled?: boolean;
    };

    const updateData: Record<string, unknown> = {};

    // AnyPay stores an optional access token + api key bundle in a single column.
    if (anypayApiKey !== undefined || anypayAccessToken !== undefined) {
      const existing = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { anypayApiKey: true, anypayApiKeyEnc: true },
      });
      const existingPlain = existing?.anypayApiKeyEnc
        ? decryptTenantKey(existing.anypayApiKeyEnc)
        : (existing?.anypayApiKey ?? '');
      const existingCreds = parseAnypayCredentialBundle(existingPlain);

      const mergedApiKey = anypayApiKey !== undefined ? anypayApiKey.trim() : existingCreds.apiKey;
      const mergedAccessToken =
        anypayAccessToken !== undefined ? anypayAccessToken.trim() : existingCreds.accessToken;

      if (!mergedApiKey && !mergedAccessToken) {
        updateData.anypayApiKeyEnc = null;
        updateData.anypayApiKey = null;
      } else {
        const bundle = !mergedApiKey || !mergedAccessToken || mergedApiKey === mergedAccessToken
          ? (mergedApiKey || mergedAccessToken)
          : `${mergedAccessToken}::${mergedApiKey}`;
        updateData.anypayApiKeyEnc = encryptTenantKey(bundle);
        updateData.anypayApiKey = null;
      }
    }

    if (anypayBaseUrl !== undefined) {
      updateData.anypayBaseUrl = normalizeBaseUrl(anypayBaseUrl);
    }

    if (anypayEnabled !== undefined) {
      updateData.anypayEnabled = Boolean(anypayEnabled);
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
    });

    logger.info('AnyPay settings updated', { tenantId, enabled: updateData.anypayEnabled });

    res.json({ success: true, message: 'Payment settings updated successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payment-settings/test
 * Verifies the configured AnyPay credentials by making a lightweight
 * authenticated call to the status endpoint.
 */
export async function testPaymentGateway(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        anypayApiKey: true,
        anypayApiKeyEnc: true,
        anypayBaseUrl: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const plain = tenant.anypayApiKeyEnc
      ? decryptTenantKey(tenant.anypayApiKeyEnc)
      : (tenant.anypayApiKey ?? '');

    if (!parseAnypayCredentialBundle(plain).apiKey) {
      res.status(400).json({ success: false, error: 'AnyPay API key is not configured' });
      return;
    }

    const gateway = new AnypayGateway(plain, tenant.anypayBaseUrl);
    const result = await gateway.getTransactionStatus('TEST_PING_' + Date.now());
    const reachable = result !== null;
    res.json({
      success: reachable,
      message: reachable
        ? 'AnyPay connection test completed.'
        : 'Could not reach AnyPay — check the credentials and base URL.',
    });
  } catch (err) {
    next(err);
  }
}
