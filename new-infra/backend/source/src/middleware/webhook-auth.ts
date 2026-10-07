import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { env } from '../config/env';

export interface WebhookAuthRequest extends Request {
  webhookTenantId?: string;
}

/**
 * Validate that the webhook URL token matches the tenant associated with the
 * payment identified by `order_id` in the request body.
 *
 * This provides authentication for providers that do not support cryptographic
 * signatures. It is defense-in-depth alongside:
 *  - only marking payments paid after verifying status with the provider API
 *  - optional IP allowlists where the provider publishes source IPs.
 */
export async function validateWebhookToken(
  req: WebhookAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.params.token;
  const body = req.body as { order_id?: string };
  const orderId = body.order_id;

  if (!token || !orderId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id: orderId }, { providerTxId: orderId }],
      },
      select: {
        tenantId: true,
        tenant: { select: { webhookSecret: true } },
      },
    });

    if (!payment?.tenant?.webhookSecret) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const expected = Buffer.from(payment.tenant.webhookSecret, 'utf8');
    const actual = Buffer.from(token, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      logger.warn('Webhook token mismatch', {
        orderId,
        provider: req.path.split('/').slice(-2)[0],
        ip: req.ip,
      });
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    req.webhookTenantId = payment.tenantId;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Validate the platform activation webhook shared secret supplied as a URL token.
 */
export function validateActivationWebhookToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.params.token;
  const expected = env.ACTIVATION_WEBHOOK_SECRET;
  if (!token || !expected) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(token, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    logger.warn('Activation webhook token mismatch', { ip: req.ip });
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}
