import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createTpLinkService } from '../services/tplink.service';
import { getIO } from '../socket';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { getPlanConfig } from '../config/plans';
import {
  allocateNextRouterControlIp,
  normalizeRouterMac,
  normalizeRouterSerial,
} from '../services/router-provisioning.service';
import {
  generateTpLinkProvisioningKey,
  generateTpLinkSshPassword,
  generateTpLinkSshUsername,
} from '../services/tplink-provisioning.service';

export async function listTpLinkRouters(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const routers = await prisma.tpLinkRouter.findMany({
      where: tenantId ? { tenantId } : {},
      select: {
        id: true,
        name: true,
        ipAddress: true,
        sshPort: true,
        username: true,
        provisioningKey: true,
        serialNumber: true,
        hardwareMac: true,
        openwrtVersion: true,
        location: true,
        status: true,
        lastSeenAt: true,
        lastBootstrapAt: true,
        provisionedAt: true,
        tenantId: true,
        createdAt: true,
        _count: { select: { sessions: { where: { status: 'ACTIVE' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: routers });
  } catch (err) {
    next(err);
  }
}

export async function createTpLinkRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { name, serialNumber, hardwareMac, openwrtVersion, location } = req.body as {
      name: string;
      serialNumber?: string;
      hardwareMac?: string;
      openwrtVersion?: string;
      location?: string;
    };

    // ── Plan limit check (routers of both vendors count toward the quota) ──
    const tenantWithSub = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: true,
        _count: { select: { routers: true, tplinkRouters: true } },
      },
    });

    const totalRouters =
      (tenantWithSub?._count.routers ?? 0) + (tenantWithSub?._count.tplinkRouters ?? 0);
    const planConfig = getPlanConfig(tenantWithSub?.subscription?.plan);
    if (planConfig.maxRouters !== -1 && totalRouters >= planConfig.maxRouters) {
      res.status(403).json({
        success: false,
        error: `Your ${planConfig.label} plan allows a maximum of ${planConfig.maxRouters} router${planConfig.maxRouters === 1 ? '' : 's'}. Upgrade your subscription to add more.`,
        limitReached: true,
        currentPlan: tenantWithSub?.subscription?.plan,
      });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    const normalizedSerial = normalizeRouterSerial(serialNumber);
    const normalizedMac = normalizeRouterMac(hardwareMac);
    const ipAddress = await allocateNextRouterControlIp();
    const username = generateTpLinkSshUsername();
    const password = generateTpLinkSshPassword();
    const provisioningKey = generateTpLinkProvisioningKey();

    const router = await prisma.tpLinkRouter.create({
      data: {
        tenantId,
        name,
        ipAddress,
        sshPort: 22,
        username,
        passwordHash: password, // stored as-is (router OS credentials, not user passwords)
        provisioningKey,
        serialNumber: normalizedSerial,
        hardwareMac: normalizedMac,
        openwrtVersion,
        location,
        status: 'OFFLINE',
        lastSeenAt: null,
      },
    });

    logger.info('TP-Link router created', { routerId: router.id, tenantId });
    const { passwordHash: _, ...safeRouter } = router;
    res.status(201).json({ success: true, data: safeRouter });
  } catch (err) {
    next(err);
  }
}

export async function getTpLinkRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    const router = await prisma.tpLinkRouter.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: tenantId! } : {}),
      },
      include: {
        _count: { select: { sessions: true } },
      },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const { passwordHash: _, ...safeRouter } = router;
    res.json({ success: true, data: safeRouter });
  } catch (err) {
    next(err);
  }
}

export async function updateTpLinkRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { name, location, openwrtVersion, serialNumber, hardwareMac } = req.body as {
      name?: string;
      location?: string;
      openwrtVersion?: string;
      serialNumber?: string;
      hardwareMac?: string;
    };

    const router = await prisma.tpLinkRouter.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const updated = await prisma.tpLinkRouter.update({
      where: { id },
      data: {
        name,
        location,
        openwrtVersion,
        serialNumber: serialNumber === undefined ? undefined : normalizeRouterSerial(serialNumber) ?? null,
        hardwareMac: hardwareMac === undefined ? undefined : normalizeRouterMac(hardwareMac) ?? null,
      },
    });

    const { passwordHash: _, ...safeRouter } = updated;
    res.json({ success: true, data: safeRouter });
  } catch (err) {
    next(err);
  }
}

export async function deleteTpLinkRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.tpLinkRouter.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    await prisma.tpLinkRouter.delete({ where: { id } });
    res.json({ success: true, message: 'Router deleted' });
  } catch (err) {
    next(err);
  }
}

export async function pingTpLinkRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.tpLinkRouter.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: req.user!.tenantId! } : {}),
      },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const online = !!router.lastBootstrapAt && (Date.now() - router.lastBootstrapAt.getTime()) < 2 * 60 * 1000;
    const newStatus = online ? 'ONLINE' : 'OFFLINE';

    await prisma.tpLinkRouter.update({
      where: { id },
      data: { status: newStatus, lastSeenAt: online ? new Date() : undefined },
    });

    const io = getIO();
    io.to(`tenant:${router.tenantId}`).emit('router:status', { routerId: id, status: newStatus });

    res.json({ success: true, data: { status: newStatus, lastBootstrapAt: router.lastBootstrapAt } });
  } catch (err) {
    next(err);
  }
}

export async function getTpLinkRouterActiveSessions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.tpLinkRouter.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: req.user!.tenantId! } : {}),
      },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const tplink = createTpLinkService(router);
    const activeSessions = await tplink.getActiveSessions(router.hotspotName);

    res.json({ success: true, data: activeSessions });
  } catch (err) {
    next(err);
  }
}
