import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { reconcileMongikeOrder } from '../services/mongike-reconciliation.service';

/**
 * AnyPay Tanzania webhook handler.
 * Called by AnyPay after payment status changes.
 */
export async function handleAnypayWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as {
      order_id?: string;
      status?: string;
      selcom_payment_status?: string;
      transid?: string;
      payment_reference?: string;
      reference?: string;
    };

    logger.info('AnyPay webhook received', {
      orderId: body.order_id,
      tenantId: (req as any).webhookTenantId,
    });

    const order_id = body.order_id;
    if (!order_id) {
      res.status(400).json({ success: false, error: 'Missing order_id' });
      return;
    }

    // Normalize: AnyPay uses COMPLETED/FAILED/PENDING
    const rawStatus = (body.status ?? body.selcom_payment_status ?? '').toUpperCase();
    let normalizedStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' | undefined;
    if (rawStatus === 'COMPLETED' || rawStatus === 'SUCCESS') {
      normalizedStatus = 'SUCCESS';
    } else if (rawStatus === 'FAILED') {
      normalizedStatus = 'FAILED';
    } else if (rawStatus === 'CANCELLED') {
      normalizedStatus = 'CANCELLED';
    }

    const transaction_id = body.transid ?? body.payment_reference ?? body.reference;

    await reconcileMongikeOrder(order_id, { status: normalizedStatus, transaction_id });

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
