import { prisma } from '../config/prisma';
import { PLANS } from '../config/plans';
import { logger } from '../config/logger';
import { createGateway } from './gateways/factory';
import { getPlatformGateway } from './platform-settings.service';
import { sessionService } from './session.service';
import { radiusService } from './radius.service';
import { subscriptionService } from './subscription.service';
import { getIO } from '../socket';

const PLAN_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(PLANS).map(([key, value]) => [key, value.priceTZS])
);

const ACTIVATION_PREFIX = 'act_';
const SUBSCRIPTION_PREFIX = 'sub_';
const NOT_FOUND_GRACE_MINUTES = 5;

export type ReconcileResult = 'completed' | 'failed' | 'pending' | 'ignored';

async function completePortalPayment(orderId: string, transactionId?: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ id: orderId }, { providerTxId: orderId }],
    },
  });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'COMPLETED', providerTxId: transactionId ?? orderId },
  });

  if (payment.sessionId) {
    // Check if this is an OMADA session before activating
    const preSession = await prisma.session.findUnique({
      where: { id: payment.sessionId },
      select: { id: true, vendor: true, tenantId: true, plan: { select: { durationMins: true } } },
    });

    if (preSession?.vendor === 'OMADA') {
      // Omada sessions don't use MikroTik/TP-Link activation.
      // Instead, finalize the session and create a RADIUS user.
      const startsAt = new Date();
      const expiresAt = new Date(startsAt.getTime() + preSession.plan.durationMins * 60 * 1000);
      await prisma.session.update({
        where: { id: payment.sessionId },
        data: { status: 'ACTIVE', startsAt, expiresAt },
      });
      // Create the RADIUS user that FreeRADIUS will authenticate
      await radiusService.createRadiusUser(preSession.tenantId, payment.sessionId, preSession.plan.durationMins);
      logger.info('Omada session activated via payment webhook', { sessionId: payment.sessionId });
    } else {
      await sessionService.activateSession(payment.sessionId);
    }

    // If direct MikroTik activation succeeded, session:activated was already emitted by sessionService.
    // If it failed (router unreachable), the session stays PENDING and the socket event was never sent.
    // Emit session:activated so the portal can show the success screen and poll for credentials.
    const session = await prisma.session.findUnique({
      where: { id: payment.sessionId },
      select: { id: true, status: true, macAddress: true, hotspotUsername: true, hotspotPassword: true, expiresAt: true, vendor: true },
    });
    if (session && session.status !== 'ACTIVE') {
      // Direct activation failed (router unreachable from VPS); the router pull-sync
      // will activate the user within ~15 s. Emit session:activated now with credentials
      // so the portal stops loading immediately. Credentials are generated at session
      // creation and are valid — the router just hasn't added the hotspot user yet.
      getIO().to(`mac:${session.macAddress}`).emit('session:activated', {
        sessionId: session.id,
        expiresAt: '', // not known yet; portal polls /portal/session/:id for the real value
        vendor: session.vendor,
        credentials: {
          username: session.hotspotUsername,
          password: session.hotspotPassword,
        },
      });
      logger.info('Emitted session:activated via webhook (router sync pending)', {
        sessionId: session.id,
        macAddress: session.macAddress,
      });
    }
  }

  logger.info('Portal payment reconciled', {
    paymentId: payment.id,
    sessionId: payment.sessionId,
    orderId,
  });

  return 'completed';
}

async function failPortalPayment(orderId: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ id: orderId }, { providerTxId: orderId }],
    },
  });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED' },
  });

  // Notify the portal so the customer sees the failure immediately.
  const session = payment.sessionId
    ? await prisma.session.findUnique({
        where: { id: payment.sessionId },
        select: { macAddress: true },
      })
    : null;
  if (session) {
    getIO().to(`mac:${session.macAddress}`).emit('payment:failed', {
      paymentId: payment.id,
      reason: 'Payment was not completed',
    });
  }

  logger.info('Portal payment marked failed', { paymentId: payment.id, orderId });
  return 'failed';
}

async function reconcileActivationPayment(orderId: string, status: string, transactionId?: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findFirst({ where: { providerTxId: orderId } });
  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  if (status === 'SUCCESS') {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', providerTxId: transactionId ?? orderId },
      }),
      prisma.tenant.update({
        where: { id: payment.tenantId },
        data: { status: 'ACTIVE' },
      }),
      prisma.subscription.upsert({
        where: { tenantId: payment.tenantId },
        update: {
          plan: 'BASIC',
          status: 'ACTIVE',
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        create: {
          tenantId: payment.tenantId,
          plan: 'BASIC',
          status: 'ACTIVE',
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    logger.info('Activation payment reconciled', {
      paymentId: payment.id,
      tenantId: payment.tenantId,
      orderId,
    });
    return 'completed';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED' },
  });

  logger.info('Activation payment marked failed', {
    paymentId: payment.id,
    tenantId: payment.tenantId,
    orderId,
    status,
  });
  return 'failed';
}

async function reconcileSubscriptionPayment(orderId: string, status: string, transactionId?: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findFirst({ where: { providerTxId: orderId } });
  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  if (status === 'SUCCESS') {
    let plan: 'BASIC' | 'STANDARD' | 'PREMIUM' = 'BASIC';
    const amount = Number(payment.amount);

    for (const [planName, price] of Object.entries(PLAN_PRICES)) {
      if (amount % price === 0) {
        plan = planName as typeof plan;
        break;
      }
    }

    const months = Math.round(amount / PLAN_PRICES[plan]);
    await subscriptionService.renewSubscription(payment.tenantId, plan, months);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'COMPLETED', providerTxId: transactionId ?? orderId },
    });

    logger.info('Subscription payment reconciled', {
      paymentId: payment.id,
      tenantId: payment.tenantId,
      orderId,
      plan,
      months,
    });
    return 'completed';
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
  logger.info('Subscription payment marked failed', {
    paymentId: payment.id,
    tenantId: payment.tenantId,
    orderId,
    status,
  });
  return 'failed';
}

/**
 * Reconcile a payment order against the provider's authoritative status API.
 *
 * Webhook callbacks are only ever a *trigger* for this function — a payment can
 * never transition to COMPLETED based on callback-supplied status alone.
 *
 * - Portal payments (WiFi plans): verified with the tenant's AnyPay account.
 * - Platform payments (`act_` / `sub_` prefixes): verified with the platform
 *   AnyPay account configured by SUPER_ADMIN.
 */
export async function reconcilePaymentOrder(orderId: string): Promise<ReconcileResult> {
  const platformOrder = orderId.startsWith(ACTIVATION_PREFIX) || orderId.startsWith(SUBSCRIPTION_PREFIX);
  const payment = platformOrder
    ? await prisma.payment.findFirst({
        where: { providerTxId: orderId },
        select: { id: true, status: true, createdAt: true },
      })
    : await prisma.payment.findFirst({
        where: { OR: [{ id: orderId }, { providerTxId: orderId }] },
        include: {
          tenant: {
            select: {
              anypayApiKey: true,
              anypayApiKeyEnc: true,
              anypayBaseUrl: true,
              anypayEnabled: true,
            },
          },
        },
      });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  let gateway;
  if (platformOrder) {
    gateway = await getPlatformGateway();
  } else {
    const tenant = (payment as { tenant?: { anypayEnabled: boolean } }).tenant;
    if (tenant && !tenant.anypayEnabled) {
      logger.warn('Skipping reconciliation — AnyPay disabled for tenant', { orderId });
      return 'pending';
    }
    gateway = createGateway((payment as any).tenant);
  }

  if (!gateway) {
    logger.warn('Skipping reconciliation — platform AnyPay not configured', { orderId });
    return 'pending';
  }

  const remote = await gateway.getTransactionStatus(orderId);

  if (!remote || !remote.status) {
    return 'pending';
  }

  // The provider may temporarily return 404 right after initiation; keep new orders pending.
  if (remote.status === 'NOT_FOUND') {
    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    const graceMs = NOT_FOUND_GRACE_MINUTES * 60 * 1000;
    if (ageMs < graceMs) {
      logger.warn('Provider returned 404 within grace window; keeping payment pending', {
        orderId,
        paymentId: payment.id,
        ageSeconds: Math.floor(ageMs / 1000),
      });
      return 'pending';
    }

    logger.warn('Marking payment FAILED: provider returned 404 for order', { orderId });
    if (orderId.startsWith(ACTIVATION_PREFIX)) return reconcileActivationPayment(orderId, 'FAILED', undefined);
    if (orderId.startsWith(SUBSCRIPTION_PREFIX)) return reconcileSubscriptionPayment(orderId, 'FAILED', undefined);
    return failPortalPayment(orderId);
  }

  if (orderId.startsWith(ACTIVATION_PREFIX)) {
    return reconcileActivationPayment(orderId, remote.status, remote.transaction_id);
  }

  if (orderId.startsWith(SUBSCRIPTION_PREFIX)) {
    return reconcileSubscriptionPayment(orderId, remote.status, remote.transaction_id);
  }

  if (remote.status === 'SUCCESS') {
    return completePortalPayment(orderId, remote.transaction_id);
  }

  if (remote.status === 'FAILED' || remote.status === 'CANCELLED') {
    return failPortalPayment(orderId);
  }

  return 'pending';
}

const PAYMENT_EXPIRY_MINUTES = 15;

export async function expireStalePendingPayments(): Promise<number> {
  const cutoff = new Date(Date.now() - PAYMENT_EXPIRY_MINUTES * 60 * 1000);
  const { count } = await prisma.payment.updateMany({
    where: {
      status: 'PENDING',
      providerTxId: null,
      createdAt: { lt: cutoff },
    },
    data: { status: 'FAILED' },
  });
  if (count > 0) {
    logger.info(`Expired ${count} stale PENDING payment(s) with no provider reference (older than ${PAYMENT_EXPIRY_MINUTES}min)`);
  }
  return count;
}

export async function reconcilePendingPayments(limit = 50): Promise<number> {
  // First, expire payments that never reached the provider (no providerTxId)
  await expireStalePendingPayments();

  const pendingPayments = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      providerTxId: { not: null },
    },
    select: { providerTxId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let resolved = 0;
  for (const payment of pendingPayments) {
    if (!payment.providerTxId) continue;
    const result = await reconcilePaymentOrder(payment.providerTxId);
    if (result === 'completed' || result === 'failed') {
      resolved += 1;
    }
  }

  return resolved;
}
