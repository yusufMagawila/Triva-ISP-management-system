import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createGateway } from '../services/gateways/factory';
import { sessionService } from '../services/session.service';
import { env } from '../config/env';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { reconcileMongikeOrder } from '../services/mongike-reconciliation.service';
import { generateWebhookSecret } from '../lib/crypto';

/**
 * Portal-facing: initiate payment for internet access.
 * Called from captive portal after user selects a plan.
 */
export async function initiatePortalPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      tenantId,
      routerId,
      planId,
      macAddress,
      ipAddress,
      phone,
    } = req.body as {
      tenantId: string;
      routerId: string;
      planId: string;
      macAddress: string;
      ipAddress?: string;
      phone: string;
    };

    // Validate tenant is active
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      include: { subscription: true },
    });

    if (!tenant) {
      res.status(403).json({ success: false, error: 'Service unavailable' });
      return;
    }

    if (tenant.status === 'PENDING') {
      res.status(403).json({ success: false, error: 'This hotspot is not yet activated. Contact the operator.' });
      return;
    }

    const isMongikeReady = tenant.paymentProvider === 'MONGIKE' && !!(tenant as any).mongikApiKeyEnc || tenant.mongikApiKey;
    const isAnypayReady = tenant.paymentProvider === 'ANYPAY' && !!(tenant as any).anypayApiKeyEnc || tenant.anypayApiKey;
    const isZenopayReady = tenant.paymentProvider === 'ZENOPAY_MOBILE' && !!(tenant as any).zenopayApiKeyEnc || tenant.zenopayApiKey;
    if (!isMongikeReady && !isAnypayReady && !isZenopayReady) {
      res.status(503).json({ success: false, error: 'Payments not configured for this hotspot. Contact operator.' });
      return;
    }

    if (
      tenant.subscription?.status === 'EXPIRED' ||
      (tenant.subscription && new Date() > tenant.subscription.expiresAt)
    ) {
      res.status(402).json({
        success: false,
        error: 'This hotspot is currently unavailable. Please contact the operator.',
      });
      return;
    }

    const validatedPlan = await prisma.plan.findFirst({
      where: { id: planId, tenantId, status: 'ACTIVE' },
    });

    if (!validatedPlan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    // Check for existing active session
    const existingSession = await sessionService.getActiveSessionByMac(macAddress, tenantId);
    if (existingSession) {
      res.json({
        success: true,
        data: { sessionId: existingSession.id, alreadyActive: true, expiresAt: existingSession.expiresAt },
      });
      return;
    }

    // Create pending session
    let session: Awaited<ReturnType<typeof sessionService.createPendingSession>>['session'];
    let plan: Awaited<ReturnType<typeof sessionService.createPendingSession>>['plan'];
    try {
      ({ session, plan } = await sessionService.createPendingSession(
        tenantId,
        routerId,
        planId,
        macAddress,
        ipAddress
      ));
    } catch (err: unknown) {
      const e = err as { code?: string; statusCode?: number; message?: string };
      if (e.code === 'SESSION_LIMIT_REACHED') {
        res.status(429).json({ success: false, error: e.message });
        return;
      }
      throw err;
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        sessionId: session.id,
        planId,
        amount: plan.price,
        phone,
        status: 'PENDING',
      },
    });

    // Initiate payment using the tenant's configured gateway
    const isAnypay = tenant.paymentProvider === 'ANYPAY';
    const isZenopay = tenant.paymentProvider === 'ZENOPAY_MOBILE';
    const providerPath = isZenopay ? 'zenopaymobile' : isAnypay ? 'anypay' : 'mongike';

    // Lazy backfill: tenants created before webhook secrets existed get one here.
    let webhookSecret = tenant.webhookSecret;
    if (!webhookSecret) {
      webhookSecret = generateWebhookSecret();
      await prisma.tenant.update({ where: { id: tenant.id }, data: { webhookSecret } });
    }
    const webhookUrl = `${env.APP_URL}/api/payments/webhook/${providerPath}/${webhookSecret}`;
    const gateway = createGateway(tenant);
    const mongikePushResponse = await gateway.initiatePayment({
      orderId: payment.id,
      amount: Number(plan.price),
      buyerPhone: phone.replace(/^\+/, ''), // strip leading + if present
      webhookUrl,
    });

    // Only store a real Mongike-generated reference. If Mongike echoes back our own
    // payment.id, keep mongikeTxId null so expireStalePendingPayments can expire it
    // after 15 min and the polling job doesn't flood Mongike with pointless 404 queries.
    const mongikeTxId = (mongikePushResponse.order_id && mongikePushResponse.order_id !== payment.id)
      ? mongikePushResponse.order_id
      : null;

    // Update payment with provider + gateway reference
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        provider: tenant.paymentProvider,
        // For AnyPay: store our order_id (their status API accepts it for polling)
        // For Mongike: only store if Mongike returned a different reference
        mongikeTxId: isAnypay ? payment.id : mongikeTxId,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        paymentId: payment.id,
        transactionId: payment.id,
        amount: plan.price,
        message: 'Check your phone for payment prompt',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Mongike webhook handler — called when payment status changes.
 */
export async function handleMongikeWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as {
      order_id: string;
      event?: string;
      status?: string;
      reference?: string;
      transaction_id?: string;
    };

    const { order_id, reference } = body;

    logger.info('Mongike webhook received', {
      orderId: order_id,
      tenantId: (req as any).webhookTenantId,
    });

    if (!order_id) {
      res.status(400).json({ success: false, error: 'Missing order_id' });
      return;
    }

    // Normalize status: Mongike sends "COMPLETED" but internally we use "SUCCESS"
    let normalizedStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' | undefined;
    const rawStatus = body.status?.toUpperCase();
    if (rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || body.event === 'payment_completed') {
      normalizedStatus = 'SUCCESS';
    } else if (rawStatus === 'FAILED') {
      normalizedStatus = 'FAILED';
    } else if (rawStatus === 'CANCELLED') {
      normalizedStatus = 'CANCELLED';
    }

    // Mongike uses "reference" as the transaction ID field
    const transaction_id = body.transaction_id ?? reference;

    await reconcileMongikeOrder(order_id, { status: normalizedStatus, transaction_id });

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

/**
 * ZenoPayMobile webhook handler.
 * ZenoPayMobile is webhook-only (no status polling endpoint), so this is the
 * authoritative signal that a payment completed.
 */
export async function handleZenoPayMobileWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as {
      order_id: string;
      status?: string;
      payment_status?: string;
    };

    const { order_id } = body;

    logger.info('ZenoPayMobile webhook received', {
      orderId: order_id,
      tenantId: (req as any).webhookTenantId,
    });

    if (!order_id) {
      res.status(400).json({ success: false, error: 'Missing order_id' });
      return;
    }

    // Normalize status: ZenoPayMobile sends various status formats
    let normalizedStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' | undefined;
    const rawStatus = (body.status || body.payment_status)?.toUpperCase();
    if (rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED') {
      normalizedStatus = 'SUCCESS';
    } else if (rawStatus === 'FAILED') {
      normalizedStatus = 'FAILED';
    } else if (rawStatus === 'CANCELLED') {
      normalizedStatus = 'CANCELLED';
    }

    // ZenoPayMobile uses order_id as the transaction reference
    const transaction_id = order_id;

    await reconcileMongikeOrder(order_id, { status: normalizedStatus, transaction_id });

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Dashboard: list payments for a tenant.
 */
export async function listPayments(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const where = { ...(tenantId ? { tenantId } : {}) };

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Dashboard: earnings summary.
 */
export async function getEarningsSummary(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayTotal, monthTotal, totalSessions, activeSessions] = await Promise.all([
      prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.session.count({ where: { tenantId } }),
      prisma.session.count({ where: { tenantId, status: 'ACTIVE' } }),
    ]);

    res.json({
      success: true,
      data: {
        todayEarnings: todayTotal._sum.amount ?? 0,
        monthEarnings: monthTotal._sum.amount ?? 0,
        totalSessions,
        activeSessions,
      },
    });
  } catch (err) {
    next(err);
  }
}
