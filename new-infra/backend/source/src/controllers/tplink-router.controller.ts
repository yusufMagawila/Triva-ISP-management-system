import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createTpLinkService } from '../services/tplink.service';
import { getIO } from '../socket';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import {
  normalizeRouterMac,
  normalizeRouterSerial,
} from '../services/router-provisioning.service';
import { createTpLinkAsset, PlanLimitError } from '../services/device-registry.service';

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

    const router = await createTpLinkAsset(tenantId, {
      name,
      serialNumber,
      hardwareMac,
      openwrtVersion,
      location,
    });

    const { passwordHash: _, passwordEnc: _e, ...safeRouter } = router;
    res.status(201).json({ success: true, data: safeRouter });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      res.status(403).json({
        success: false,
        error: err.message,
        limitReached: true,
        currentPlan: err.currentPlan,
      });
      return;
    }
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
