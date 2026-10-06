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

    // The callback is only a trigger: AnyPay provides an authoritative
    // order-status endpoint, so the claimed status in the body is never
    // trusted — reconcileMongikeOrder queries check-order-status itself.
    await reconcileMongikeOrder(order_id);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
