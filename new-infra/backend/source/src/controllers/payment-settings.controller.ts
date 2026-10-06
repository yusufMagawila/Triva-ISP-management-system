import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { encryptTenantKey, decryptTenantKey } from '../lib/crypto';
import { AnypayGateway, parseAnypayCredentialBundle } from '../services/gateways/anypay.gateway';
import { MongikeGateway } from '../services/gateways/mongike.gateway';
import { ZenoPayMobileGateway } from '../services/gateways/zenopay-mobile.gateway';
import { createGateway } from '../services/gateways/factory';

const VALID_PROVIDERS = ['MONGIKE', 'ANYPAY', 'ZENOPAY_MOBILE'];

/**
 * GET /api/payment-settings
 * Returns the current payment gateway configuration for the tenant.
 * API keys are masked for security.
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
        paymentProvider: true,
        mongikApiKey: true,
        mongikApiKeyEnc: true,
        anypayApiKey: true,
        anypayApiKeyEnc: true,
        zenopayApiKey: true,
        zenopayApiKeyEnc: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const anypayPlain = tenant.anypayApiKeyEnc
      ? decryptTenantKey(tenant.anypayApiKeyEnc)
      : (tenant.anypayApiKey ?? '');
    const anypayCreds = parseAnypayCredentialBundle(anypayPlain);

    res.json({
      success: true,
      data: {
        paymentProvider: tenant.paymentProvider,
        mongikApiKey: tenant.mongikApiKeyEnc || tenant.mongikApiKey ? '********' : null,
        anypayApiKey: anypayCreds.apiKey ? '********' : null,
        anypayAccessToken: anypayCreds.accessToken ? '********' : null,
        zenopayApiKey: tenant.zenopayApiKeyEnc || tenant.zenopayApiKey ? '********' : null,
        mongikReady: !!(tenant.mongikApiKeyEnc || tenant.mongikApiKey),
        anypayReady: !!anypayCreds.apiKey,
        zenopayReady: !!(tenant.zenopayApiKeyEnc || tenant.zenopayApiKey),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/payment-settings
 * Updates the payment gateway configuration.
 */
export async function updatePaymentSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const {
      paymentProvider,
      mongikApiKey,
      anypayApiKey,
      anypayAccessToken,
      zenopayApiKey,
    } = req.body as {
      paymentProvider?: 'MONGIKE' | 'ANYPAY' | 'ZENOPAY_MOBILE';
      mongikApiKey?: string;
      anypayApiKey?: string;
      anypayAccessToken?: string;
      zenopayApiKey?: string;
    };

    if (paymentProvider && !VALID_PROVIDERS.includes(paymentProvider)) {
      res.status(400).json({ success: false, error: 'Invalid payment provider' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (paymentProvider) updateData.paymentProvider = paymentProvider;

    if (mongikApiKey !== undefined) {
      updateData.mongikApiKeyEnc = mongikApiKey ? encryptTenantKey(mongikApiKey) : null;
      updateData.mongikApiKey = mongikApiKey ? null : null; // clear legacy plaintext
    }
    if (zenopayApiKey !== undefined) {
      updateData.zenopayApiKeyEnc = zenopayApiKey ? encryptTenantKey(zenopayApiKey) : null;
      updateData.zenopayApiKey = zenopayApiKey ? null : null;
    }

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

    await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
    });

    logger.info('Payment settings updated', { tenantId, paymentProvider });

    res.json({ success: true, message: 'Payment settings updated successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payment-settings/test
 * Tests the gateway connection by making a lightweight API call.
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
        paymentProvider: true,
        mongikApiKey: true,
        mongikApiKeyEnc: true,
        anypayApiKey: true,
        anypayApiKeyEnc: true,
        zenopayApiKey: true,
        zenopayApiKeyEnc: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const gateway = createGateway(tenant as any);
    await gateway.getTransactionStatus('TEST_PING_' + Date.now());
    res.json({ success: true, message: `${tenant.paymentProvider} connection test completed.` });
  } catch (err) {
    next(err);
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(key.length - 8) + key.slice(-4);
}
