import { prisma } from '../config/prisma';
import { createMikroTikService, MikroTikService } from './mikrotik.service';
import { createTpLinkService } from './tplink.service';
import { getIO } from '../socket';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { Router, Plan } from '@prisma/client';
import { getPlanConfig } from '../config/plans';
import { normalizeRouterMac } from './router-provisioning.service';
import { radiusService } from './radius.service';

function normalizeClientMacAddress(macAddress: string): string {
  let decoded = macAddress.trim();

  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }

  const normalized = normalizeRouterMac(decoded);
  if (!normalized) {
    throw new Error('Invalid MAC address');
  }

  return normalized;
}

export class SessionService {
  private emitSessionActivated(
    session: {
      id: string;
      macAddress: string;
      tenantId: string;
      hotspotUsername: string;
      hotspotPassword: string;
    },
    expiresAt: Date
  ): void {
    const io = getIO();
    io.to(`mac:${session.macAddress}`).emit('session:activated', {
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      credentials: {
        username: session.hotspotUsername,
        password: session.hotspotPassword,
      },
    });
    io.to(`tenant:${session.tenantId}`).emit('session:activated', {
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async finalizeSessionActivation(sessionId: string, activatedAt = new Date()): Promise<Date | null> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        plan: true,
        payment: { select: { status: true } },
      },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'ACTIVE') {
      return session.expiresAt;
    }

    if (session.status !== 'PENDING' || session.payment?.status !== 'COMPLETED') {
      return null;
    }

    const expiresAt = new Date(activatedAt.getTime() + session.plan.durationMins * 60 * 1000);

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'ACTIVE',
        startsAt: activatedAt,
        expiresAt,
      },
    });

    this.emitSessionActivated(session, expiresAt);
    return expiresAt;
  }

  /**
   * Create a pending session before payment is confirmed.
   */
  async createPendingSession(
    tenantId: string,
    routerId: string,
    planId: string,
    macAddress: string,
    ipAddress?: string
  ) {
    const normalizedMacAddress = normalizeClientMacAddress(macAddress);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });

    // The portal passes a single router id — resolve it against both vendor tables.
    const router = await prisma.router.findUnique({ where: { id: routerId } });
    const tplinkRouter = router
      ? null
      : await prisma.tpLinkRouter.findUnique({ where: { id: routerId } });

    if (!router && !tplinkRouter) {
      throw new Error('Router not found');
    }

    const vendor: 'MIKROTIK' | 'TPLINK' = router ? 'MIKROTIK' : 'TPLINK';

    // Validate router belongs to tenant
    if ((router?.tenantId ?? tplinkRouter!.tenantId) !== tenantId) {
      throw new Error('Router not found for this tenant');
    }

    // ── Plan daily session limit check ────────────────────────────────────
    const tenantSub = await prisma.subscription.findUnique({ where: { tenantId } });
    const planConfig = getPlanConfig(tenantSub?.plan);
    if (planConfig.maxSessionsPerDay !== -1) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sessionsToday = await prisma.session.count({
        where: {
          tenantId,
          createdAt: { gte: startOfDay },
          status: { in: ['ACTIVE', 'PENDING', 'EXPIRED', 'DISCONNECTED'] },
        },
      });
      if (sessionsToday >= planConfig.maxSessionsPerDay) {
        throw Object.assign(
          new Error(`Daily session limit of ${planConfig.maxSessionsPerDay} reached for ${planConfig.label} plan. The operator must upgrade their subscription.`),
          { code: 'SESSION_LIMIT_REACHED', statusCode: 429 }
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Generate unique hotspot credentials
    const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
    const hotspotUsername = `u_${suffix}`;
    const hotspotPassword = uuidv4().replace(/-/g, '').slice(0, 12);

    const session = await prisma.session.create({
      data: {
        tenantId,
        routerId: vendor === 'MIKROTIK' ? routerId : null,
        tplinkRouterId: vendor === 'TPLINK' ? routerId : null,
        vendor,
        planId,
        macAddress: normalizedMacAddress,
        ipAddress,
        hotspotUsername,
        hotspotPassword,
        status: 'PENDING',
      },
    });

    logger.info('Pending session created', { sessionId: session.id, macAddress: normalizedMacAddress, vendor });
    return { session, plan, router: router ?? tplinkRouter! };
  }

  /**
   * Activate a session on MikroTik after successful payment.
   */
  async activateSession(sessionId: string): Promise<void> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { plan: true, router: true, tplinkRouter: true },
    });

    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'ACTIVE') return; // already active, idempotent

    const { plan } = session;
    const startsAt = new Date();

    if (session.vendor === 'TPLINK') {
      const tplinkRouter = session.tplinkRouter;
      if (!tplinkRouter) throw new Error(`Session ${sessionId} has no TP-Link router`);

      try {
        const tplink = createTpLinkService(tplinkRouter);
        await tplink.addHotspotUser(tplinkRouter.hotspotName, {
          name: session.hotspotUsername,
          password: session.hotspotPassword,
          macAddress: session.macAddress,
          comment: `session:${session.id}`,
          durationMins: plan.durationMins,
          downloadKbps: plan.downloadKbps ?? undefined,
          uploadKbps: plan.uploadKbps ?? undefined,
        });

        const expiresAt = await this.finalizeSessionActivation(sessionId, startsAt);
        logger.info('Session activated (TP-Link direct)', { sessionId, expiresAt });
      } catch (err) {
        logger.warn('Direct TP-Link activation failed, waiting for router pull sync fallback', { sessionId, err });
        await prisma.session.update({
          where: { id: sessionId },
          data: { status: 'PENDING' }, // revert, pull-sync will retry
        });
      }
      return;
    }

    const router = session.router;
    if (!router) throw new Error(`Session ${sessionId} has no MikroTik router`);
    const mikrotik = createMikroTikService(router);

    const profileName = `plan_${plan.id.slice(0, 8)}`;
    const uptime = MikroTikService.minutesToUptime(plan.durationMins);

    try {
      // Ensure bandwidth profile exists
      if (plan.downloadKbps || plan.uploadKbps) {
        await mikrotik.createOrUpdateProfile(
          router.hotspotName,
          profileName,
          plan.downloadKbps ?? undefined,
          plan.uploadKbps ?? undefined
        );
      }

      // Add hotspot user with time limit
      await mikrotik.addHotspotUser(router.hotspotName, {
        name: session.hotspotUsername,
        password: session.hotspotPassword,
        macAddress: session.macAddress,
        limitUptime: uptime,
        profile: plan.downloadKbps ? profileName : undefined,
        comment: `session:${session.id}`,
      });

      const expiresAt = await this.finalizeSessionActivation(sessionId, startsAt);

      logger.info('Session activated', { sessionId, expiresAt });
    } catch (err) {
      logger.warn('Direct MikroTik activation failed, waiting for router pull sync fallback', { sessionId, err });
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'PENDING' }, // revert, webhook will retry
      });
    }
  }

  /**
   * Expire a session – disconnect user from MikroTik and update DB.
   */
  async expireSession(sessionId: string): Promise<void> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { router: true, tplinkRouter: true },
    });

    if (!session || session.status === 'EXPIRED') return;

    if (session.vendor === 'OMADA') {
      // Omada sessions: disable the RADIUS user so they can't re-authenticate.
      // The AP will disconnect the client when the RADIUS Session-Timeout expires.
      // No CoA/Disconnect is possible on AP-only (no gateway).
      try {
        await radiusService.removeRadiusUser(sessionId);
      } catch (err) {
        logger.warn('Failed to disable RADIUS user on session expiry', { sessionId, err });
      }
    } else if (session.vendor === 'TPLINK' && session.tplinkRouter) {
      try {
        const tplink = createTpLinkService(session.tplinkRouter);
        await tplink.disconnectHotspotSession(session.tplinkRouter.hotspotName, session.macAddress);
        await tplink.removeHotspotUser(session.tplinkRouter.hotspotName, session.hotspotUsername);
      } catch (err) {
        logger.warn('Failed to remove expired client from TP-Link (pull sync will reconcile)', {
          sessionId,
          err,
        });
      }
    } else if (session.router) {
      const mikrotik = createMikroTikService(session.router);

      try {
        // Remove from hotspot and disconnect active session
        await mikrotik.disconnectHotspotSession(
          session.router.hotspotName,
          session.hotspotUsername
        );
        await mikrotik.removeHotspotUser(session.router.hotspotName, session.hotspotUsername);
      } catch (err) {
        logger.warn('Failed to remove expired user from MikroTik (may already be gone)', {
          sessionId,
          err,
        });
      }
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'EXPIRED' },
    });

    const io = getIO();
    io.to(`mac:${session.macAddress}`).emit('session:expired', {
      sessionId,
      macAddress: session.macAddress,
    });

    logger.info('Session expired', { sessionId });
  }

  /**
   * Manually disconnect a user session.
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { router: true, tplinkRouter: true },
    });

    if (!session) throw new Error('Session not found');

    if (session.vendor === 'OMADA') {
      // Omada: disable RADIUS user. AP will disconnect on next re-auth attempt.
      try {
        await radiusService.removeRadiusUser(sessionId);
      } catch (err) {
        logger.warn('Failed to disable RADIUS user on disconnect', { sessionId, err });
      }
    } else if (session.vendor === 'TPLINK' && session.tplinkRouter) {
      try {
        const tplink = createTpLinkService(session.tplinkRouter);
        await tplink.disconnectHotspotSession(session.tplinkRouter.hotspotName, session.macAddress);
        await tplink.removeHotspotUser(session.tplinkRouter.hotspotName, session.hotspotUsername);
      } catch (err) {
        logger.warn('Direct TP-Link disconnect failed, router pull sync will remove the session', {
          sessionId,
          err,
        });
      }
    } else if (session.router) {
      const mikrotik = createMikroTikService(session.router);

      try {
        await mikrotik.disconnectHotspotSession(session.router.hotspotName, session.hotspotUsername);
        await mikrotik.removeHotspotUser(session.router.hotspotName, session.hotspotUsername);
      } catch (err) {
        logger.warn('Direct MikroTik disconnect failed, router pull sync will remove the session', {
          sessionId,
          err,
        });
      }
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'DISCONNECTED' },
    });

    const io = getIO();
    io.to(`mac:${session.macAddress}`).emit('session:expired', {
      sessionId,
      macAddress: session.macAddress,
    });

    logger.info('Session manually disconnected', { sessionId });
  }

  /**
   * Find an active session by MAC address.
   */
  async getActiveSessionByMac(macAddress: string, tenantId: string) {
    const normalizedMacAddress = normalizeClientMacAddress(macAddress);

    return prisma.session.findFirst({
      where: {
        macAddress: normalizedMacAddress,
        tenantId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      include: { plan: true },
    });
  }
}

export const sessionService = new SessionService();
