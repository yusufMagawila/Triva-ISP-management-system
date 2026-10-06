import { prisma } from '../config/prisma';
import { PLANS } from '../config/plans';
import { logger } from '../config/logger';
import { decryptTenantKey } from '../lib/crypto';
import { MongikeGateway } from './gateways/mongike.gateway';
import { AnypayGateway } from './gateways/anypay.gateway';
import { sessionService } from './session.service';
import { radiusService } from './radius.service';
import { subscriptionService } from './subscription.service';
import { MongikeWebhookPayload } from '../types';
import { getIO } from '../socket';

const PLAN_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(PLANS).map(([key, value]) => [key, value.priceTZS])
);

const ACTIVATION_PREFIX = 'act_';
const SUBSCRIPTION_PREFIX = 'sub_';
const NOT_FOUND_GRACE_MINUTES = 5;

export type MongikeReconcileResult = 'completed' | 'failed' | 'pending' | 'ignored';

async function completePortalPayment(orderId: string, transactionId?: string): Promise<MongikeReconcileResult> {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ id: orderId }, { mongikeTxId: orderId }],
    },
  });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'COMPLETED', mongikeTxId: transactionId ?? orderId },
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
    // Emit payment:confirmed so the portal can show the success screen and poll for credentials.
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

async function failPortalPayment(orderId: string): Promise<MongikeReconcileResult> {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ id: orderId }, { mongikeTxId: orderId }],
    },
  });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED' },
  });

  logger.info('Portal payment marked failed', { paymentId: payment.id, orderId });
  return 'failed';
}

async function reconcileActivationPayment(orderId: string, status: string, transactionId?: string): Promise<MongikeReconcileResult> {
  const payment = await prisma.payment.findFirst({ where: { mongikeTxId: orderId } });
  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  if (status === 'SUCCESS') {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', mongikeTxId: transactionId ?? orderId },
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

async function reconcileSubscriptionPayment(orderId: string, status: string, transactionId?: string): Promise<MongikeReconcileResult> {
  const payment = await prisma.payment.findFirst({ where: { mongikeTxId: orderId } });
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
      data: { status: 'COMPLETED', mongikeTxId: transactionId ?? orderId },
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

export async function reconcileMongikeOrder(
  orderId: string,
  remoteOverride?: Partial<Pick<MongikeWebhookPayload, 'status' | 'transaction_id'>> | null
): Promise<MongikeReconcileResult> {
  const platformOrder = orderId.startsWith(ACTIVATION_PREFIX) || orderId.startsWith(SUBSCRIPTION_PREFIX);
  const payment = platformOrder
    ? await prisma.payment.findFirst({
        where: { mongikeTxId: orderId },
        include: {
          tenant: {
            select: {
              mongikApiKey: true,
              mongikApiKeyEnc: true,
              anypayApiKey: true,
              anypayApiKeyEnc: true,
            },
          },
        },
      })
    : await prisma.payment.findFirst({
        where: { OR: [{ id: orderId }, { mongikeTxId: orderId }] },
        include: {
          tenant: {
            select: {
              mongikApiKey: true,
              mongikApiKeyEnc: true,
              anypayApiKey: true,
              anypayApiKeyEnc: true,
            },
          },
        },
      });

  if (!payment || payment.status !== 'PENDING') {
    return 'ignored';
  }

  const tenantAny = payment.tenant as any;
  const mongikKey = tenantAny.mongikApiKeyEnc
    ? decryptTenantKey(tenantAny.mongikApiKeyEnc)
    : (tenantAny.mongikApiKey ?? undefined);
  const anypayKey = tenantAny.anypayApiKeyEnc
    ? decryptTenantKey(tenantAny.anypayApiKeyEnc)
    : (tenantAny.anypayApiKey ?? '');

  let service: MongikeGateway | AnypayGateway;
  if (platformOrder) {
    service = new MongikeGateway();
  } else if ((payment as any).provider === 'ANYPAY') {
    service = new AnypayGateway(anypayKey);
  } else {
    service = new MongikeGateway(mongikKey);
  }
  const remote = remoteOverride?.status ? remoteOverride : await service.getTransactionStatus(orderId);

  if (!remote || !remote.status) {
    return 'pending';
  }

  // Mongike may temporarily return 404 right after initiation; keep new orders pending.
  if (remote.status === 'NOT_FOUND') {
    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    const graceMs = NOT_FOUND_GRACE_MINUTES * 60 * 1000;
    if (ageMs < graceMs) {
      logger.warn('Mongike returned 404 within grace window; keeping payment pending', {
        orderId,
        paymentId: payment.id,
        ageSeconds: Math.floor(ageMs / 1000),
      });
      return 'pending';
    }

    logger.warn('Marking payment FAILED: Mongike returned 404 for order', { orderId });
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
      mongikeTxId: null,
      createdAt: { lt: cutoff },
    },
    data: { status: 'FAILED' },
  });
  if (count > 0) {
    logger.info(`Expired ${count} stale PENDING payment(s) with no Mongike order (older than ${PAYMENT_EXPIRY_MINUTES}min)`);
  }
  return count;
}

export async function reconcilePendingMongikePayments(limit = 50): Promise<number> {
  // First, expire payments that never reached Mongike (no mongikeTxId)
  await expireStalePendingPayments();

  const pendingPayments = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      mongikeTxId: { not: null },
    },
    select: { mongikeTxId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let resolved = 0;
  for (const payment of pendingPayments) {
    if (!payment.mongikeTxId) continue;
    const result = await reconcileMongikeOrder(payment.mongikeTxId);
    if (result === 'completed' || result === 'failed') {
      resolved += 1;
    }
  }

  return resolved;
}