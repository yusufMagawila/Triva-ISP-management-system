import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { sessionService } from '../services/session.service';
import { radiusService } from '../services/radius.service';
import { logger } from '../config/logger';
import { env } from '../config/env';

/**
 * Omada Portal Info endpoint.
 *
 * Called by the captive portal when a customer arrives from an Omada
 * Custom Portal Page redirect. The captive portal passes:
 *   - tenantId (resolved from the Omada site configuration)
 *   - mac (clientMac from Omada)
 *   - apMac, ssidName, radioId, vid, originUrl (forwarded from Omada)
 *
 * Returns tenant info + plans, same structure as getPortalInfo but
 * without requiring a routerId (Omada has no router in the DB).
 */
export async function getOmadaPortalInfo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.query.tenantId as string;
    const siteId = req.query.siteId as string;
    const macAddress = req.query.mac as string;

    // Resolve tenantId from siteId if provided (preferred - from OmadaSite asset)
    let resolvedTenantId = tenantId;
    if (siteId) {
      const omadaSite = await prisma.omadaSite.findUnique({
        where: { id: siteId },
        select: { id: true, tenantId: true, name: true, status: true },
      });
      if (!omadaSite) {
        res.status(404).json({ success: false, error: 'Omada site not found' });
        return;
      }
      resolvedTenantId = omadaSite.tenantId;
      // Update lastSeenAt - the site is being used
      await prisma.omadaSite.update({
        where: { id: siteId },
        data: { lastSeenAt: new Date() },
      }).catch(() => {}); // non-critical
    }

    if (!resolvedTenantId) {
      res.status(400).json({ success: false, error: 'Missing tenantId or siteId' });
      return;
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: resolvedTenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        status: true,
        portalNoticeName: true,
        portalNoticeMessage: true,
        portalNoticeColor: true,
        subscription: { select: { status: true, expiresAt: true } },
      },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      res.status(404).json({ success: false, error: 'Hotspot not available' });
      return;
    }

    const sub = tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.status(402).json({
        success: false,
        error: 'This hotspot service is currently suspended. Contact the operator.',
        tenantName: tenant.name,
      });
      return;
    }

    // Check for existing active session
    let activeSession = null;
    if (macAddress) {
      activeSession = await sessionService.getActiveSessionByMac(macAddress, tenantId);
    }

    const plans = await prisma.plan.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        durationMins: true,
        downloadKbps: true,
        uploadKbps: true,
        dataLimitMb: true,
      },
      orderBy: { price: 'asc' },
    });

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          logoUrl: tenant.logoUrl,
          portalNoticeName: tenant.portalNoticeName,
          portalNoticeMessage: tenant.portalNoticeMessage,
          portalNoticeColor: tenant.portalNoticeColor,
        },
        plans,
        activeSession: activeSession
          ? { id: activeSession.id, expiresAt: activeSession.expiresAt, plan: activeSession.plan }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Initiate Omada payment.
 *
 * Called by the captive portal when an Omada customer selects a plan
 * and enters their phone number. Creates a pending OMADA session and
 * a payment record, then initiates payment via the tenant's gateway.
 *
 * This mirrors initiatePortalPayment but for Omada (no routerId needed).
 */
export async function initiateOmadaPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { tenantId, siteId, planId, macAddress, ipAddress, phone } = req.body as {
      tenantId?: string;
      siteId?: string;
      planId: string;
      macAddress: string;
      ipAddress?: string;
      phone: string;
    };

    // Resolve tenantId from siteId if provided
    let resolvedTenantId = tenantId;
    let resolvedSiteId = siteId;
    if (siteId && !tenantId) {
      const site = await prisma.omadaSite.findUnique({ where: { id: siteId }, select: { tenantId: true } });
      if (!site) {
        res.status(404).json({ success: false, error: 'Omada site not found' });
        return;
      }
      resolvedTenantId = site.tenantId;
    }

    if (!resolvedTenantId) {
      res.status(400).json({ success: false, error: 'Missing tenantId or siteId' });
      return;
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: resolvedTenantId },
      include: { subscription: true },
    });

    if (!tenant) {
      res.status(403).json({ success: false, error: 'Service unavailable' });
      return;
    }

    if (tenant.status !== 'ACTIVE') {
      res.status(403).json({ success: false, error: 'This hotspot is not yet activated.' });
      return;
    }

    if (!tenant.anypayEnabled || (!tenant.anypayApiKeyEnc && !tenant.anypayApiKey)) {
      res.status(503).json({ success: false, error: 'Payments not configured for this hotspot.' });
      return;
    }

    if (tenant.subscription?.status === 'EXPIRED' ||
        (tenant.subscription && new Date() > tenant.subscription.expiresAt)) {
      res.status(402).json({ success: false, error: 'This hotspot is currently unavailable.' });
      return;
    }

    const plan = await prisma.plan.findFirst({ where: { id: planId, tenantId, status: 'ACTIVE' } });
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    // Check for existing active session
    const existing = await sessionService.getActiveSessionByMac(macAddress, resolvedTenantId);
    if (existing) {
      res.json({
        success: true,
        data: { sessionId: existing.id, alreadyActive: true, expiresAt: existing.expiresAt },
      });
      return;
    }

    // Create pending OMADA session (no router — both routerId and tplinkRouterId are null)
    const { v4: uuidv4 } = await import('uuid');
    const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
    const hotspotUsername = `u_${suffix}`;
    const hotspotPassword = uuidv4().replace(/-/g, '').slice(0, 12);

    const session = await prisma.session.create({
      data: {
        tenantId: resolvedTenantId,
        routerId: null,
        tplinkRouterId: null,
        omadaSiteId: resolvedSiteId ?? null,
        vendor: 'OMADA',
        planId,
        macAddress,
        ipAddress,
        hotspotUsername,
        hotspotPassword,
        status: 'PENDING',
      },
    });

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        tenantId: resolvedTenantId,
        sessionId: session.id,
        planId,
        amount: plan.price,
        phone,
        status: 'PENDING',
      },
    });

    // Initiate payment via the tenant's AnyPay gateway
    const { createGateway } = await import('../services/gateways/factory');

    // Lazy backfill: tenants created before webhook secrets existed get one here.
    let webhookSecret = tenant.webhookSecret;
    if (!webhookSecret) {
      const { generateWebhookSecret } = await import('../lib/crypto');
      webhookSecret = generateWebhookSecret();
      await prisma.tenant.update({ where: { id: tenant.id }, data: { webhookSecret } });
    }
    const webhookUrl = `${env.APP_URL}/api/payments/webhook/anypay/${webhookSecret}`;
    const gateway = createGateway(tenant);

    let pushResponse;
    try {
      pushResponse = await gateway.initiatePayment({
        orderId: payment.id,
        amount: Number(plan.price),
        buyerPhone: phone.replace(/^\+/, ''),
        webhookUrl,
      });
    } catch (err) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      res.status(502).json({
        success: false,
        error: 'The payment provider could not be reached. Please try again.',
      });
      return;
    }

    const providerTxId = (pushResponse.order_id && pushResponse.order_id !== payment.id)
      ? pushResponse.order_id
      : payment.id;

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        provider: 'ANYPAY',
        providerTxId,
      },
    });

    logger.info('Omada payment initiated', { sessionId: session.id, paymentId: payment.id });

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
 * Redeem voucher for Omada customer.
 *
 * Called by the captive portal when an Omada customer enters a voucher code.
 * Validates the voucher, creates an OMADA session, marks the voucher as redeemed,
 * creates the RADIUS user, and returns the Omada portal token for redirect.
 */
export async function redeemOmadaVoucher(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { tenantId, siteId, macAddress, ipAddress, code } = req.body as {
      tenantId?: string;
      siteId?: string;
      macAddress: string;
      ipAddress?: string;
      code: string;
    };

    // Resolve tenantId from siteId if provided
    let resolvedTenantId = tenantId;
    let resolvedSiteId = siteId;
    if (siteId && !tenantId) {
      const site = await prisma.omadaSite.findUnique({ where: { id: siteId }, select: { tenantId: true } });
      if (!site) {
        res.status(404).json({ success: false, error: 'Omada site not found' });
        return;
      }
      resolvedTenantId = site.tenantId;
    }

    if (!resolvedTenantId || !macAddress || !code) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    // Validate tenant
    const tenant = await prisma.tenant.findFirst({
      where: { id: resolvedTenantId },
      select: { id: true, status: true, subscription: { select: { status: true, expiresAt: true } } },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      res.status(403).json({ success: false, error: 'Service unavailable' });
      return;
    }

    if (tenant.subscription?.status === 'EXPIRED' ||
        (tenant.subscription && new Date() > tenant.subscription.expiresAt)) {
      res.status(402).json({ success: false, error: 'Service suspended' });
      return;
    }

    // Check for existing active session
    const existing = await sessionService.getActiveSessionByMac(macAddress, resolvedTenantId);
    if (existing) {
      res.json({
        success: true,
        data: { sessionId: existing.id, alreadyActive: true, expiresAt: existing.expiresAt },
      });
      return;
    }

    // Find the voucher
    const voucher = await prisma.voucher.findFirst({
      where: { code, tenantId: resolvedTenantId, status: 'ACTIVE' },
      include: { plan: true },
    });

    if (!voucher) {
      res.status(404).json({ success: false, error: 'Invalid or expired voucher code' });
      return;
    }

    if (voucher.expiresAt && new Date() > voucher.expiresAt) {
      await prisma.voucher.update({ where: { id: voucher.id }, data: { status: 'EXPIRED' } });
      res.status(404).json({ success: false, error: 'Voucher has expired' });
      return;
    }

    // Create OMADA session
    const { v4: uuidv4 } = await import('uuid');
    const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
    const hotspotUsername = `u_${suffix}`;
    const hotspotPassword = uuidv4().replace(/-/g, '').slice(0, 12);

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + voucher.plan.durationMins * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        tenantId: resolvedTenantId,
        routerId: null,
        tplinkRouterId: null,
        omadaSiteId: resolvedSiteId ?? null,
        vendor: 'OMADA',
        planId: voucher.planId,
        macAddress,
        ipAddress,
        hotspotUsername,
        hotspotPassword,
        status: 'ACTIVE',
        startsAt,
        expiresAt,
      },
    });

    // Mark voucher as redeemed
    await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: 'REDEEMED',
        redeemedAt: new Date(),
        redeemedMac: macAddress,
        sessionId: session.id,
      },
    });

    // Create RADIUS user for this session
    await radiusService.createRadiusUser(resolvedTenantId, session.id, voucher.plan.durationMins);

    // Create Omada portal token for the redirect back
    const token = await radiusService.createOmadaPortalToken(resolvedTenantId, session.id);

    logger.info('Omada voucher redeemed', { sessionId: session.id, voucherId: voucher.id });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        expiresAt: expiresAt.toISOString(),
        omadaToken: token,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Omada redirect URL.
 *
 * After payment is confirmed (via webhook + socket event), the captive
 * portal calls this to get the Omada portal token and the redirect URL
 * to send the customer back to the Omada Controller.
 *
 * The redirect URL format is:
 *   https://<controller-ip>/portal/?<original_omada_params>&triva_token=<token>
 *
 * Since we don't know the controller URL at the backend, we return the
 * token and let the captive portal construct the redirect URL from the
 * original Omada parameters it saved when the customer arrived.
 */
export async function getOmadaRedirectData(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionId } = req.params;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        tenantId: true,
        vendor: true,
        payment: { select: { status: true } },
        voucher: { select: { id: true } },
      },
    });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.vendor !== 'OMADA') {
      res.status(400).json({ success: false, error: 'Not an Omada session' });
      return;
    }

    // Session must be ACTIVE or payment COMPLETED or voucher redeemed
    const isReady = session.status === 'ACTIVE' ||
                    session.payment?.status === 'COMPLETED' ||
                    !!session.voucher;

    if (!isReady) {
      res.status(402).json({ success: false, error: 'Payment not confirmed yet' });
      return;
    }

    // Ensure RADIUS user exists (in case this is called right after payment confirmation
    // and the webhook hasn't created it yet)
    const existingRadiusUser = await radiusService.getRadiusUserBySession(sessionId);
    if (!existingRadiusUser) {
      // Look up the plan to get duration
      const fullSession = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { plan: { select: { durationMins: true } } },
      });
      if (fullSession) {
        await radiusService.createRadiusUser(session.tenantId, sessionId, fullSession.plan.durationMins);
      }
    }

    // Create the Omada portal token
    const token = await radiusService.createOmadaPortalToken(session.tenantId, sessionId);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        omadaToken: token,
      },
    });
  } catch (err) {
    next(err);
  }
}
