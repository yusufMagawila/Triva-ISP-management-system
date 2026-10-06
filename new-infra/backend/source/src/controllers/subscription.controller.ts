import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { mongikeService, MongikeService } from '../services/mongike.service';
import { subscriptionService } from '../services/subscription.service';
import { env } from '../config/env';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { PLANS, PlanName } from '../config/plans';
import { reconcileMongikeOrder } from '../services/mongike-reconciliation.service';

// Derived from the single source of truth
const PLAN_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(PLANS).map(([k, v]) => [k, v.priceTZS])
);

/**
 * GET /api/subscription — get current tenant subscription status
 */
export async function getSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const status = await subscriptionService.getSubscriptionStatus(tenantId);
    res.json({
      success: true,
      data: {
        ...status,
        planPrices: PLAN_PRICES,
        planLimits: Object.fromEntries(
          Object.entries(PLANS).map(([k, v]) => [k, {
            maxRouters: v.maxRouters,
            maxSessionsPerDay: v.maxSessionsPerDay,
          }])
        ),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/subscription/pay — initiate subscription payment via Mongike
 */
export async function initiateSubscriptionPayment(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { plan, months, phone } = req.body as {
      plan: 'BASIC' | 'STANDARD' | 'PREMIUM';
      months: number;
      phone: string;
    };

    const pricePerMonth = PLAN_PRICES[plan];
    if (!pricePerMonth) {
      res.status(400).json({ success: false, error: 'Invalid plan' });
      return;
    }

    const totalAmount = pricePerMonth * (months || 1);

    // Subscription payments use the PLATFORM key (the platform collects subscription fees from merchants)
    // so we use the platform key here, not the tenant's key
    const orderId = `sub_${tenantId}_${Date.now()}`;
    const webhookUrl = `${env.APP_URL}/api/subscription/webhook/${env.ACTIVATION_WEBHOOK_SECRET}`;

    await mongikeService.initiatePayment({
      orderId,
      amount: totalAmount,
      buyerPhone: phone.replace(/^\+/, ''),
      webhookUrl,
    });

    // Store the pending subscription order as a payment record
    await prisma.payment.create({
      data: {
        tenantId,
        amount: totalAmount,
        currency: 'TZS',
        phone,
        status: 'PENDING',
        mongikeTxId: orderId,
      },
    });

    logger.info('Subscription payment initiated', { tenantId, plan, months, totalAmount, orderId });

    res.json({
      success: true,
      data: {
        orderId,
        amount: totalAmount,
        plan,
        months,
        message: 'Check your phone for the payment prompt',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/subscription/webhook — Mongike webhook for subscription payments
 */
export async function handleSubscriptionWebhook(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { order_id, status, transaction_id } = req.body as {
      order_id: string;
      status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      transaction_id?: string;
    };

    if (!order_id) {
      res.status(400).json({ success: false, error: 'Missing order_id' });
      return;
    }

    // order_id format: sub_<tenantId>_<timestamp>
    if (!order_id.startsWith('sub_')) {
      res.status(200).json({ received: true });
      return;
    }

    await reconcileMongikeOrder(order_id, { status, transaction_id });

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
