import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { sessionService } from '../services/session.service';
import { MikroTikService } from '../services/mikrotik.service';
import {
  buildRouterBootstrapScript,
  buildRouterBootstrapUrls,
  normalizeRouterMac,
  normalizeRouterSerial,
} from '../services/router-provisioning.service';

function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getProvisioningKey(req: Request): string | undefined {
  if (typeof req.params.provisioningKey === 'string' && req.params.provisioningKey.trim()) {
    return req.params.provisioningKey.trim();
  }

  if (typeof req.query.provisioningKey === 'string' && req.query.provisioningKey.trim()) {
    return req.query.provisioningKey.trim();
  }

  return undefined;
}

function buildBootstrapSyncScript(
  router: { id: string; name: string; hotspotName: string; provisioningKey: string },
  pendingSessions: Array<{
    id: string;
    macAddress: string;
    hotspotUsername: string;
    hotspotPassword: string;
    plan: {
      id: string;
      durationMins: number;
      downloadKbps: number | null;
      uploadKbps: number | null;
    };
  }>,
  removableSessions: Array<{
    id: string;
    hotspotUsername: string;
  }>
): string {
  const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
  const lines = [
    '# TRIVA HOTSPOT LIVE SYNC',
    `# Router: ${router.name}`,
    `# Router ID: ${router.id}`,
    `# Pending activations: ${pendingSessions.length}`,
    `# Pending removals: ${removableSessions.length}`,
    '',
  ];

  // Always refresh the hotspot login page so portal fixes propagate automatically.
  const loginHtmlUrl = `${apiUrl}/api/portal/router/${encodeURIComponent(router.id)}/hotspot/login.html`;
  const escapedLoginHtmlUrl = escapeRouterOsString(loginHtmlUrl);
  lines.push(':do {');
  lines.push(`  /tool fetch mode=https url="${escapedLoginHtmlUrl}" dst-path="hotspot/login.html" check-certificate=no keep-result=yes`);
  lines.push('} on-error={');
  lines.push('  :log warning "TRIVA: login.html refresh failed"');
  lines.push('}');
  lines.push('');

  if (pendingSessions.length === 0 && removableSessions.length === 0) {
    lines.push(':put "TRIVA sync: no changes"');
    return lines.join('\n');
  }

  for (const session of pendingSessions) {
    const comment = `session:${session.id}`;
    const escapedComment = escapeRouterOsString(comment);
    const escapedUsername = escapeRouterOsString(session.hotspotUsername);
    const escapedPassword = escapeRouterOsString(session.hotspotPassword);
    const escapedMac = escapeRouterOsString(session.macAddress);
    const escapedHotspotName = escapeRouterOsString(router.hotspotName);
    const uptime = escapeRouterOsString(MikroTikService.minutesToUptime(session.plan.durationMins));
    const ackUrl = `${apiUrl}/bootstrap/sync/${encodeURIComponent(router.provisioningKey)}/ack/${encodeURIComponent(session.id)}`;

    lines.push(`:local ackUrl \"${ackUrl}\"`);

    if (session.plan.downloadKbps) {
      const profileName = escapeRouterOsString(`plan_${session.plan.id.slice(0, 8)}`);
      const uploadKbps = session.plan.uploadKbps ?? session.plan.downloadKbps;
      const rateLimit = escapeRouterOsString(`${uploadKbps}k/${session.plan.downloadKbps}k`);
      lines.push(`:if ([:len [/ip hotspot user/profile find where name=\"${profileName}\"]] = 0) do={`);
      lines.push(`  /ip hotspot user/profile add name=\"${profileName}\" shared-users=1 rate-limit=\"${rateLimit}\"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user/profile set [/ip hotspot user/profile find where name=\"${profileName}\"] shared-users=1 rate-limit=\"${rateLimit}\"`);
      lines.push('}');
      lines.push(`:if ([:len [/ip hotspot user find where comment=\"${escapedComment}\"]] = 0) do={`);
      lines.push(`  /ip hotspot user add server=\"${escapedHotspotName}\" name=\"${escapedUsername}\" password=\"${escapedPassword}\" mac-address=\"${escapedMac}\" limit-uptime=\"${uptime}\" profile=\"${profileName}\" comment=\"${escapedComment}\"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user set [/ip hotspot user find where comment=\"${escapedComment}\"] server=\"${escapedHotspotName}\" name=\"${escapedUsername}\" password=\"${escapedPassword}\" mac-address=\"${escapedMac}\" limit-uptime=\"${uptime}\" profile=\"${profileName}\" comment=\"${escapedComment}\"`);
      lines.push('}');
    } else {
      lines.push(`:if ([:len [/ip hotspot user find where comment=\"${escapedComment}\"]] = 0) do={`);
      lines.push(`  /ip hotspot user add server=\"${escapedHotspotName}\" name=\"${escapedUsername}\" password=\"${escapedPassword}\" mac-address=\"${escapedMac}\" limit-uptime=\"${uptime}\" comment=\"${escapedComment}\"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user set [/ip hotspot user find where comment=\"${escapedComment}\"] server=\"${escapedHotspotName}\" name=\"${escapedUsername}\" password=\"${escapedPassword}\" mac-address=\"${escapedMac}\" limit-uptime=\"${uptime}\" comment=\"${escapedComment}\"`);
      lines.push('}');
    }

    lines.push(':do {');
    lines.push('  /tool fetch mode=https url=$ackUrl keep-result=no check-certificate=no');
    lines.push('} on-error={');
    lines.push(`  :log warning \"TRIVA sync ack failed for ${session.id}\"`);
    lines.push('}');
    lines.push('');
  }

  for (const session of removableSessions) {
    const escapedComment = escapeRouterOsString(`session:${session.id}`);
    const escapedUsername = escapeRouterOsString(session.hotspotUsername);
    lines.push(`:if ([:len [/ip hotspot active find where user=\"${escapedUsername}\"]] > 0) do={`);
    lines.push(`  /ip hotspot active remove [/ip hotspot active find where user=\"${escapedUsername}\"]`);
    lines.push('}');
    lines.push(`:if ([:len [/ip hotspot user find where comment=\"${escapedComment}\"]] > 0) do={`);
    lines.push(`  /ip hotspot user remove [/ip hotspot user find where comment=\"${escapedComment}\"]`);
    lines.push('}');
    lines.push('');
  }

  lines.push(`:put \"TRIVA sync applied: ${pendingSessions.length} activation(s), ${removableSessions.length} removal(s)\"`);
  return lines.join('\n');
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

async function findBootstrapRouter(
  provisioningKey?: string,
  serialNumber?: string,
  macAddress?: string
) {
  if (provisioningKey) {
    return prisma.router.findFirst({ where: { provisioningKey } });
  }

  if (serialNumber) {
    return prisma.router.findFirst({ where: { serialNumber } });
  }

  if (macAddress) {
    return prisma.router.findFirst({ where: { hardwareMac: macAddress } });
  }

  return null;
}

async function upsertBootstrapIdentity(
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

  return prisma.router.update({
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

export async function bootstrapRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const serialNumber = normalizeRouterSerial(typeof req.query.serialNumber === 'string' ? req.query.serialNumber : undefined);
    const hardwareMac = normalizeRouterMac(typeof req.query.macAddress === 'string' ? req.query.macAddress : undefined);

    const router = await findBootstrapRouter(provisioningKey, serialNumber, hardwareMac);
    if (!router) {
      res.status(404).json({ success: false, error: 'Router asset not found for this bootstrap identity' });
      return;
    }

    const boundRouter = await upsertBootstrapIdentity(router, {
      serialNumber,
      hardwareMac,
      remoteIp: getRequestIp(req),
    });

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
    const bootstrapUrls = buildRouterBootstrapUrls(boundRouter, apiUrl);

    logger.info('Router bootstrap requested', {
      routerId: boundRouter.id,
      serialNumber: boundRouter.serialNumber,
      hardwareMac: boundRouter.hardwareMac,
    });

    res.type('text/plain').send(buildRouterBootstrapScript(boundRouter, apiUrl));
  } catch (err) {
    next(err);
  }
}

export async function getBootstrapRouterInfo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const router = await findBootstrapRouter(provisioningKey);
    if (!router) {
      res.status(404).json({ success: false, error: 'Router asset not found for this bootstrap identity' });
      return;
    }

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
    const bootstrapUrls = buildRouterBootstrapUrls(router, apiUrl);

    res.json({
      success: true,
      data: {
        router: {
          id: router.id,
          name: router.name,
          hotspotName: router.hotspotName,
          controlPlaneIp: router.ipAddress,
          apiPort: router.apiPort,
          apiUsername: router.username,
          apiPassword: router.passwordHash,
          provisioningKey: router.provisioningKey,
          serialNumber: router.serialNumber,
          hardwareMac: router.hardwareMac,
          provisionedAt: router.provisionedAt,
        },
        bootstrap: {
          model: 'staged',
          urls: bootstrapUrls,
          legacyDirectReachability: false,
          notes: [
            'TRIVA no longer assumes public reachability to a private MikroTik LAN IP.',
            'The router self-provisions by calling the bootstrap endpoint and then keeps checking in automatically.',
            'This stage uses router-initiated control-plane sync and prepares the asset for future VPN-based management.',
          ],
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function heartbeatBootstrapRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const serialNumber = normalizeRouterSerial(typeof req.query.serialNumber === 'string' ? req.query.serialNumber : undefined);
    const hardwareMac = normalizeRouterMac(typeof req.query.macAddress === 'string' ? req.query.macAddress : undefined);

    const router = await findBootstrapRouter(provisioningKey, serialNumber, hardwareMac);
    if (!router) {
      res.status(404).type('text/plain').send('Router asset not found');
      return;
    }

    const updated = await upsertBootstrapIdentity(router, {
      serialNumber,
      hardwareMac,
      remoteIp: getRequestIp(req),
    });

    res.type('text/plain').send(`OK ${updated.id}`);
  } catch (err) {
    next(err);
  }
}

export async function getBootstrapSyncScript(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);

    const router = await prisma.router.findFirst({
      where: { provisioningKey },
      select: {
        id: true,
        name: true,
        hotspotName: true,
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
          routerId: router.id,
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
          routerId: router.id,
          status: { in: ['EXPIRED', 'DISCONNECTED'] },
        },
        select: {
          id: true,
          hotspotUsername: true,
        },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    const syncRouter = {
      id: router.id,
      name: router.name,
      hotspotName: router.hotspotName,
      provisioningKey: router.provisioningKey,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send(buildBootstrapSyncScript(syncRouter, pendingSessions, removableSessions));
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeBootstrapSyncActivation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provisioningKey = getProvisioningKey(req);
    const { sessionId } = req.params;

    const router = await prisma.router.findFirst({
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
        routerId: router.id,
      },
      select: { id: true },
    });

    if (!session) {
      res.status(404).type('text/plain').send('Session not found');
      return;
    }

    const expiresAt = await sessionService.finalizeSessionActivation(session.id);
    logger.info('Bootstrap sync activation acknowledged', {
      routerId: router.id,
      sessionId: session.id,
      expiresAt,
    });

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
}