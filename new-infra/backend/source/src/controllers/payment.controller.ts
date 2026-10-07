import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createGateway } from '../services/gateways/factory';
import { sessionService } from '../services/session.service';
import { env } from '../config/env';
import { AuthRequest } from '../types';
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

    if (!tenant.anypayEnabled || (!tenant.anypayApiKeyEnc && !tenant.anypayApiKey)) {
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

    // Create payment record — amount always comes from the authoritative plan,
    // never from the client.
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

    // Lazy backfill: tenants created before webhook secrets existed get one here.
    let webhookSecret = tenant.webhookSecret;
    if (!webhookSecret) {
      webhookSecret = generateWebhookSecret();
      await prisma.tenant.update({ where: { id: tenant.id }, data: { webhookSecret } });
    }
    const webhookUrl = `${env.APP_URL}/api/payments/webhook/anypay/${webhookSecret}`;
    const gateway = createGateway(tenant);
    const pushResponse = await gateway.initiatePayment({
      orderId: payment.id,
      amount: Number(plan.price),
      buyerPhone: phone.replace(/^\+/, ''), // strip leading + if present
      webhookUrl,
    });

    // Store our order id — AnyPay's status API accepts it as the lookup key. If
    // AnyPay returned a different reference, keep that instead.
    const providerTxId =
      pushResponse.order_id && pushResponse.order_id !== payment.id
        ? pushResponse.order_id
        : payment.id;

    await prisma.payment.update({
      where: { id: payment.id },
      data: { provider: 'ANYPAY', providerTxId },
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
