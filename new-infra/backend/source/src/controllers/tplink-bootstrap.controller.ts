import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { sessionService } from '../services/session.service';
import {
  normalizeRouterMac,
  normalizeRouterSerial,
} from '../services/router-provisioning.service';
import {
  buildTpLinkBootstrapScript,
  buildTpLinkBootstrapUrls,
  buildTpLinkSyncScript,
} from '../services/tplink-provisioning.service';

function getProvisioningKey(req: Request): string | undefined {
  if (typeof req.params.provisioningKey === 'string' && req.params.provisioningKey.trim()) {
    return req.params.provisioningKey.trim();
  }
  if (typeof req.query.provisioningKey === 'string' && req.query.provisioningKey.trim()) {
    return req.query.provisioningKey.trim();
  }
  return undefined;
}

function getRequestIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return forwarded[0]?.split(',')[0]?.trim();
  }
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip || undefined;
}

async function findTpLinkBootstrapRouter(
  provisioningKey?: string,
  serialNumber?: string,
  macAddress?: string
) {
  if (provisioningKey) {
    return prisma.tpLinkRouter.findFirst({ where: { provisioningKey } });
  }
  if (serialNumber) {
    return prisma.tpLinkRouter.findFirst({ where: { serialNumber } });
  }
  if (macAddress) {
    return prisma.tpLinkRouter.findFirst({ where: { hardwareMac: macAddress } });
  }
  return null;
}

async function upsertTpLinkBootstrapIdentity(
  router: {
    id: string;
    serialNumber: string | null;
    hardwareMac: string | null;
    provisionedAt: Date | null;
  },
  identity: {
    serialNumber?: string;
    hardwareMac?: string;
    remoteIp?: string;
  }
) {
  if (identity.serialNumber && router.serialNumber && router.serialNumber !== identity.serialNumber) {
    throw Object.assign(new Error('Serial number does not match the bound router asset'), { statusCode: 409 });
  }

  if (identity.hardwareMac && router.hardwareMac && router.hardwareMac !== identity.hardwareMac) {
    throw Object.assign(new Error('MAC address does not match the bound router asset'), { statusCode: 409 });
  }

  return prisma.tpLinkRouter.update({
    where: { id: router.id },
    data: {
      serialNumber: router.serialNumber ?? identity.serialNumber,
      hardwareMac: router.hardwareMac ?? identity.hardwareMac,
      lastBootstrapAt: new Date(),
      lastBootstrapIp: identity.remoteIp,
      lastSeenAt: new Date(),
      provisionedAt: router.provisionedAt ?? new Date(),
      status: 'ONLINE',
    },
  });
}

export async function bootstrapTpLinkRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const serialNumber = normalizeRouterSerial(typeof req.query.serialNumber === 'string' ? req.query.serialNumber : undefined);
    const hardwareMac = normalizeRouterMac(typeof req.query.macAddress === 'string' ? req.query.macAddress : undefined);

    const router = await findTpLinkBootstrapRouter(provisioningKey, serialNumber, hardwareMac);
    if (!router) {
      res.status(404).json({ success: false, error: 'TP-Link router asset not found for this bootstrap identity' });
      return;
    }

    const boundRouter = await upsertTpLinkBootstrapIdentity(router, {
      serialNumber,
      hardwareMac,
      remoteIp: getRequestIp(req),
    });

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';

    logger.info('TP-Link router bootstrap requested', {
      routerId: boundRouter.id,
      serialNumber: boundRouter.serialNumber,
      hardwareMac: boundRouter.hardwareMac,
    });

    res.type('text/plain').send(buildTpLinkBootstrapScript(boundRouter, apiUrl));
  } catch (err) {
    next(err);
  }
}

export async function getTpLinkBootstrapRouterInfo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const router = await findTpLinkBootstrapRouter(provisioningKey);
    if (!router) {
      res.status(404).json({ success: false, error: 'TP-Link router asset not found for this bootstrap identity' });
      return;
    }

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
    const bootstrapUrls = buildTpLinkBootstrapUrls(router, apiUrl);

    res.json({
      success: true,
      data: {
        router: {
          id: router.id,
          name: router.name,
          vendor: 'TPLINK',
          controlPlaneIp: router.ipAddress,
          sshPort: router.sshPort,
          sshUsername: router.username,
          provisioningKey: router.provisioningKey,
          serialNumber: router.serialNumber,
          hardwareMac: router.hardwareMac,
          openwrtVersion: router.openwrtVersion,
          provisionedAt: router.provisionedAt,
        },
        bootstrap: {
          model: 'staged',
          urls: bootstrapUrls,
          legacyDirectReachability: false,
          notes: [
            'TP-Link routers must run OpenWrt with nodogsplash for TRIVA hotspot billing.',
            'The router self-provisions by fetching the bootstrap script and piping it to sh, then keeps checking in automatically.',
            'Paid sessions activate through the router-initiated pull-sync loop; no inbound reachability is assumed.',
          ],
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function heartbeatTpLinkRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const serialNumber = normalizeRouterSerial(typeof req.query.serialNumber === 'string' ? req.query.serialNumber : undefined);
    const hardwareMac = normalizeRouterMac(typeof req.query.macAddress === 'string' ? req.query.macAddress : undefined);

    const router = await findTpLinkBootstrapRouter(provisioningKey, serialNumber, hardwareMac);
    if (!router) {
      res.status(404).type('text/plain').send('Router asset not found');
      return;
    }

    const updated = await upsertTpLinkBootstrapIdentity(router, {
      serialNumber,
      hardwareMac,
      remoteIp: getRequestIp(req),
    });

    res.type('text/plain').send(`OK ${updated.id}`);
  } catch (err) {
    next(err);
  }
}

export async function getTpLinkBootstrapSyncScript(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);

    const router = await prisma.tpLinkRouter.findFirst({
      where: { provisioningKey },
      select: {
        id: true,
        name: true,
        provisioningKey: true,
        tenant: {
          select: {
            status: true,
            subscription: {
              select: { status: true, expiresAt: true },
            },
          },
        },
      },
    });

    if (!router || !router.provisioningKey || router.tenant.status !== 'ACTIVE') {
      res.status(404).type('text/plain').send('Router not available');
      return;
    }

    const sub = router.tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.status(404).type('text/plain').send('Router subscription inactive');
      return;
    }

    const [pendingSessions, removableSessions] = await Promise.all([
      prisma.session.findMany({
        where: {
          tplinkRouterId: router.id,
          status: 'PENDING',
          payment: { is: { status: 'COMPLETED' } },
        },
        select: {
          id: true,
          macAddress: true,
          hotspotUsername: true,
          hotspotPassword: true,
          plan: {
            select: {
              id: true,
              durationMins: true,
              downloadKbps: true,
              uploadKbps: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.session.findMany({
        where: {
          tplinkRouterId: router.id,
          status: { in: ['EXPIRED', 'DISCONNECTED'] },
        },
        select: {
          id: true,
          macAddress: true,
          hotspotUsername: true,
        },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
    const syncRouter = {
      id: router.id,
      name: router.name,
      provisioningKey: router.provisioningKey,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send(buildTpLinkSyncScript(syncRouter, apiUrl, pendingSessions, removableSessions));
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeTpLinkSyncActivation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const { sessionId } = req.params;

    const router = await prisma.tpLinkRouter.findFirst({
      where: { provisioningKey },
      select: { id: true },
    });

    if (!router) {
      res.status(404).type('text/plain').send('Router not found');
      return;
    }

    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        tplinkRouterId: router.id,
      },
      select: { id: true },
    });

    if (!session) {
      res.status(404).type('text/plain').send('Session not found');
      return;
    }

    const expiresAt = await sessionService.finalizeSessionActivation(session.id);
    logger.info('TP-Link bootstrap sync activation acknowledged', {
      routerId: router.id,
      sessionId: session.id,
      expiresAt,
    });

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
}
