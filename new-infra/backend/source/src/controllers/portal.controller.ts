import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { sessionService } from '../services/session.service';
import { MikroTikService } from '../services/mikrotik.service';
import { verifyRouterSyncToken } from '../services/router-sync-auth.service';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { AuthRequest } from '../types';

function buildSubscriptionExpiredHtml(tenantName: string): string {
  const escaped = tenantName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Service Suspended</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:40px 28px;max-width:380px;width:100%;text-align:center}
    .icon{width:72px;height:72px;border-radius:50%;background:rgba(239,68,68,.15);border:2px solid rgba(239,68,68,.35);margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:32px}
    h1{font-size:22px;font-weight:700;margin-bottom:12px;letter-spacing:-.02em}
    .sub{color:#94a3b8;font-size:14px;line-height:1.65;margin-bottom:24px}
    .chip{display:inline-block;padding:8px 18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:13px;color:#cbd5e1}
    .footer{margin-top:28px;font-size:11px;color:#334155}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x26D4;</div>
    <h1>Hotspot Suspended</h1>
    <p class="sub">This WiFi hotspot is temporarily unavailable.<br/>The operator needs to renew their TRIVA subscription to restore access.</p>
    <div class="chip">Operated by <strong>${escaped}</strong></div>
    <p class="footer">Powered by TRIVA WiFi Platform</p>
  </div>
</body>
</html>`;
}

// Bump this version whenever the redirect logic or portal app changes significantly.
// A new value forces a fresh portal load even on devices with a cached old bundle.
const PORTAL_ENTRY_VERSION = '20260514-v4';

function buildHotspotLoginHtml(routerId: string, portalBaseUrl: string): string {
  const portalEntryUrl = `${portalBaseUrl}?pv=${PORTAL_ENTRY_VERSION}`;

  // NOTE: MikroTik's $(xxx-esc) variables URL-encode their values for safe embedding.
  // We use them inside JS string literals (safe, because % is not special in JS strings),
  // then call decodeURIComponent() so URLSearchParams.set() re-encodes them exactly once.
  // This avoids the double-encoding bug that occurs with GET form submission.
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <meta http-equiv="pragma" content="no-cache" />
  <meta http-equiv="expires" content="0" />
  <title>TRIVA WiFi</title>
</head>
<body>
<script>
(function () {
  try {
    var base = '${portalEntryUrl}';
    var url = new URL(base);
    url.searchParams.set('router', '${routerId}');
    function sp(key, esc) {
      try { url.searchParams.set(key, decodeURIComponent(esc)); }
      catch (e) { if (esc) url.searchParams.set(key, esc); }
    }
    sp('mac',              '$(mac-esc)');
    sp('ip',               '$(ip-esc)');
    sp('link-login',       '$(link-login-esc)');
    sp('link-login-only',  '$(link-login-only-esc)');
    url.searchParams.set('hotspot-server-address', '$(server-address)');
    url.searchParams.set('hotspot-ssl-login',      '$(ssl-login)');
    sp('link-orig',        '$(link-orig-esc)');
    sp('error',            '$(error-esc)');
    window.location.replace(url.toString());
  } catch (e) {
    window.location.replace('${portalEntryUrl}&router=${routerId}');
  }
})();
</script>
<noscript>
  <p style="font-family:sans-serif;text-align:center;padding:40px">
    JavaScript is required to connect. Please enable it in your browser settings.
  </p>
</noscript>
</body>
</html>`;
}

function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildRouterHotspotSyncScript(
  router: { id: string; name: string; hotspotName: string; provisioningKey: string | null },
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
    const ackUrl = escapeRouterOsString(
      `${apiUrl}/bootstrap/sync/${encodeURIComponent(router.provisioningKey ?? '')}/ack/${encodeURIComponent(session.id)}`
    );

    if (session.plan.downloadKbps) {
      const profileName = escapeRouterOsString(`plan_${session.plan.id.slice(0, 8)}`);
      const uploadKbps = session.plan.uploadKbps ?? session.plan.downloadKbps;
      const rateLimit = escapeRouterOsString(`${uploadKbps}k/${session.plan.downloadKbps}k`);
      lines.push(`:if ([:len [/ip hotspot user/profile find where name="${profileName}"]] = 0) do={`);
      lines.push(`  /ip hotspot user/profile add name="${profileName}" shared-users=1 rate-limit="${rateLimit}"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user/profile set [/ip hotspot user/profile find where name="${profileName}"] shared-users=1 rate-limit="${rateLimit}"`);
      lines.push('}');
      lines.push(`:if ([:len [/ip hotspot user find where comment="${escapedComment}"]] = 0) do={`);
      lines.push(`  /ip hotspot user add server="${escapedHotspotName}" name="${escapedUsername}" password="${escapedPassword}" mac-address="${escapedMac}" limit-uptime="${uptime}" profile="${profileName}" comment="${escapedComment}"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user set [/ip hotspot user find where comment="${escapedComment}"] server="${escapedHotspotName}" name="${escapedUsername}" password="${escapedPassword}" mac-address="${escapedMac}" limit-uptime="${uptime}" profile="${profileName}" comment="${escapedComment}"`);
      lines.push('}');
    } else {
      lines.push(`:if ([:len [/ip hotspot user find where comment="${escapedComment}"]] = 0) do={`);
      lines.push(`  /ip hotspot user add server="${escapedHotspotName}" name="${escapedUsername}" password="${escapedPassword}" mac-address="${escapedMac}" limit-uptime="${uptime}" comment="${escapedComment}"`);
      lines.push('} else={');
      lines.push(`  /ip hotspot user set [/ip hotspot user find where comment="${escapedComment}"] server="${escapedHotspotName}" name="${escapedUsername}" password="${escapedPassword}" mac-address="${escapedMac}" limit-uptime="${uptime}" comment="${escapedComment}"`);
      lines.push('}');
    }

    lines.push(`:do { /tool fetch mode=https url="${ackUrl}" keep-result=no check-certificate=no } on-error={ :put "TRIVA sync ack failed for ${session.id}" }`);
    lines.push('');
  }

  for (const session of removableSessions) {
    const escapedComment = escapeRouterOsString(`session:${session.id}`);
    const escapedUsername = escapeRouterOsString(session.hotspotUsername);
    lines.push(`:if ([:len [/ip hotspot active find where user="${escapedUsername}"]] > 0) do={`);
    lines.push(`  /ip hotspot active remove [/ip hotspot active find where user="${escapedUsername}"]`);
    lines.push('}');
    lines.push(`:if ([:len [/ip hotspot user find where comment="${escapedComment}"]] > 0) do={`);
    lines.push(`  /ip hotspot user remove [/ip hotspot user find where comment="${escapedComment}"]`);
    lines.push('}');
    lines.push('');
  }

  lines.push(`:put "TRIVA sync applied: ${pendingSessions.length} activation(s), ${removableSessions.length} removal(s)"`);
  return lines.join('\n');
}

/**
 * Public portal endpoint: get tenant info + plans by router ID.
 * Called by the captive portal page to populate plan selection.
 */
export async function getPortalInfo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { routerId } = req.params;
    const macAddress = req.query.mac as string;

    const routerSelect = {
      id: true,
      name: true,
      hotspotName: true,
      status: true,
      tenantId: true,
      tenant: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          status: true,
          subscription: {
            select: { status: true, expiresAt: true },
          },
        },
      },
    } as const;

    // Resolve the id across both vendor tables (MikroTik first, then TP-Link)
    // so the captive-portal frontend needs no vendor-specific logic.
    const router =
      (await prisma.router.findUnique({ where: { id: routerId }, select: routerSelect })) ??
      (await prisma.tpLinkRouter.findUnique({ where: { id: routerId }, select: routerSelect }));

    if (!router || router.tenant.status !== 'ACTIVE') {
      res.status(404).json({ success: false, error: 'Hotspot not available' });
      return;
    }

    // Check subscription
    const sub = router.tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.status(402).json({
        success: false,
        error: 'This hotspot service is currently suspended. Contact the operator.',
        tenantName: router.tenant.name,
      });
      return;
    }

    // Check for active session if MAC provided
    let activeSession = null;
    if (macAddress) {
      activeSession = await sessionService.getActiveSessionByMac(macAddress, router.tenantId);
    }

    const plans = await prisma.plan.findMany({
      where: { tenantId: router.tenantId, status: 'ACTIVE' },
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
        router: { id: router.id, name: router.name },
        tenant: { id: router.tenant.id, name: router.tenant.name, logoUrl: router.tenant.logoUrl },
        plans,
        activeSession: activeSession
          ? {
              id: activeSession.id,
              expiresAt: activeSession.expiresAt,
              plan: activeSession.plan,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Public portal endpoint: check payment/session status by sessionId.
 */
export async function checkSessionStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionId } = req.params;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        plan: { select: { name: true, durationMins: true } },
        payment: { select: { status: true } },
      },
    });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: session.id,
        status: session.status,
        vendor: session.vendor,
        macAddress: session.macAddress,
        expiresAt: session.expiresAt,
        plan: session.plan,
        paymentStatus: session.payment?.status ?? null,
        // Return credentials as soon as payment is confirmed so the portal can show
        // the success screen and attempt hotspot login. The router pull-sync will
        // activate the hotspot user within ~15 s if direct activation failed.
        credentials:
          session.status === 'ACTIVE' || session.payment?.status === 'COMPLETED'
            ? { username: session.hotspotUsername, password: session.hotspotPassword }
            : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Public endpoint used by MikroTik installer script to fetch router-specific login.html.
 */
export async function getRouterHotspotLoginPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { routerId } = req.params;

    const router = await prisma.router.findUnique({
      where: { id: routerId },
      select: {
        id: true,
        tenant: {
          select: {
            name: true,
            status: true,
            subscription: {
              select: { status: true, expiresAt: true },
            },
          },
        },
      },
    });

    if (!router || router.tenant.status !== 'ACTIVE') {
      res.status(404).type('text/plain').send('Router not available');
      return;
    }

    const sub = router.tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.type('html').send(buildSubscriptionExpiredHtml(router.tenant.name));
      return;
    }

    const portalBaseUrl = `${env.PORTAL_URL}/captive-portal/`;
    res.type('html').send(buildHotspotLoginHtml(router.id, portalBaseUrl));
  } catch (err) {
    next(err);
  }
}

function buildTpLinkSplashHtml(routerId: string, portalBaseUrl: string): string {
  const portalEntryUrl = `${portalBaseUrl}?pv=${PORTAL_ENTRY_VERSION}`;

  // NOTE: nodogsplash substitutes $clientmac, $clientip and $requesturi
  // when serving splash.html from /etc/nodogsplash/htdocs.
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <meta http-equiv="pragma" content="no-cache" />
  <meta http-equiv="expires" content="0" />
  <title>TRIVA WiFi</title>
</head>
<body>
<script>
(function () {
  try {
    var base = '${portalEntryUrl}';
    var url = new URL(base);
    url.searchParams.set('router', '${routerId}');
    function sp(key, value) {
      if (value && value.charAt(0) !== '$') url.searchParams.set(key, value);
    }
    sp('mac',       '$clientmac');
    sp('ip',        '$clientip');
    sp('link-orig', '$requesturi');
    window.location.replace(url.toString());
  } catch (e) {
    window.location.replace('${portalEntryUrl}&router=${routerId}');
  }
})();
</script>
<noscript>
  <p style="font-family:sans-serif;text-align:center;padding:40px">
    JavaScript is required to connect. Please enable it in your browser settings.
  </p>
</noscript>
</body>
</html>`;
}

/**
 * Public endpoint used by the TP-Link/OpenWrt bootstrap script to fetch the
 * router-specific nodogsplash splash.html.
 */
export async function getTpLinkSplashPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { routerId } = req.params;

    const router = await prisma.tpLinkRouter.findUnique({
      where: { id: routerId },
      select: {
        id: true,
        tenant: {
          select: {
            name: true,
            status: true,
            subscription: {
              select: { status: true, expiresAt: true },
            },
          },
        },
      },
    });

    if (!router || router.tenant.status !== 'ACTIVE') {
      res.status(404).type('text/plain').send('Router not available');
      return;
    }

    const sub = router.tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.type('html').send(buildSubscriptionExpiredHtml(router.tenant.name));
      return;
    }

    const portalBaseUrl = `${env.PORTAL_URL}/captive-portal/`;
    res.type('html').send(buildTpLinkSplashHtml(router.id, portalBaseUrl));
  } catch (err) {
    next(err);
  }
}

export async function getRouterHotspotSyncScript(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { routerId } = req.params;
    const token = req.query.token as string | undefined;

    const router = await prisma.router.findUnique({
      where: { id: routerId },
      select: {
        id: true,
        name: true,
        hotspotName: true,
        provisioningKey: true,
        passwordHash: true,
        passwordEnc: true,
        updatedAt: true,
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

    if (!router || router.tenant.status !== 'ACTIVE') {
      res.status(404).type('text/plain').send('Router not available');
      return;
    }

    const sub = router.tenant.subscription;
    if (sub?.status === 'EXPIRED' || (sub && new Date() > sub.expiresAt)) {
      res.status(404).type('text/plain').send('Router subscription inactive');
      return;
    }

    if (!verifyRouterSyncToken(router, token)) {
      res.status(401).type('text/plain').send('Unauthorized');
      return;
    }

    const [pendingSessions, removableSessions] = await Promise.all([
      prisma.session.findMany({
        where: {
          routerId,
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
          routerId,
          status: { in: ['EXPIRED', 'DISCONNECTED'] },
        },
        select: {
          id: true,
          hotspotUsername: true,
        },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send(buildRouterHotspotSyncScript(router, pendingSessions, removableSessions));
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeRouterHotspotSyncActivation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { routerId } = req.params;
    const { sessionId } = req.query as { sessionId?: string };
    const token = req.query.token as string | undefined;

    if (!sessionId) {
      res.status(400).type('text/plain').send('Missing sessionId');
      return;
    }

    const router = await prisma.router.findUnique({
      where: { id: routerId },
      select: {
        id: true,
        passwordHash: true,
        passwordEnc: true,
        updatedAt: true,
      },
    });

    if (!router || !verifyRouterSyncToken(router, token)) {
      res.status(401).type('text/plain').send('Unauthorized');
      return;
    }

    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        routerId,
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      res.status(404).type('text/plain').send('Session not found');
      return;
    }

    const expiresAt = await sessionService.finalizeSessionActivation(session.id);
    logger.info('Router pull sync activation acknowledged', {
      routerId,
      sessionId: session.id,
      expiresAt,
    });

    res.type('text/plain').send('OK');
  } catch (err) {
    next(err);
  }
}


// ─── Omada Integration (RADIUS-based) ─────────────────────────────────────────
//
// These endpoints are for the TP-Link Omada Custom Portal Page flow.
// They are completely isolated from the MikroTik and TP-Link OpenWrt flows.
//
// Flow:
//   1. Client connects to Omada SSID → Custom Portal Page loaded
//   2. No triva_token → redirect to TRIVA captive portal for payment
//   3. Payment confirmed → TRIVA creates RADIUS user + Omada portal token
//   4. TRIVA redirects back to Omada Controller with ?triva_token=<token>
//   5. Custom Portal Page POSTs {token} to /api/portal/omada/credentials
//   6. TRIVA validates token (single-use, 60s TTL), returns RADIUS credentials
//   7. Custom Portal Page auto-submits credentials to /portal/radius/auth
//
// SECURITY:
//   - Token is 32-byte crypto-random (256 bits entropy)
//   - Token expires in 60 seconds
//   - Token is single-use (invalidated after first consumption)
//   - Token is sent via POST body, not URL (won't appear in nginx logs)
//   - RADIUS passwords and tokens are never logged

import { radiusService } from '../services/radius.service';

/**
 * POST /api/portal/omada/credentials
 *
 * Exchange a single-use Omada portal token for RADIUS credentials.
 * The Custom Portal Page calls this after receiving the triva_token
 * from TRIVA's redirect back to the Omada Controller.
 *
 * Request body: { "token": "<43-char base64url token>" }
 * Response:     { "success": true, "data": { "username": "...", "password": "..." } }
 * Error:        401 if token is invalid, expired, or already used
 *               400 if token is missing
 *
 * The token is invalidated immediately after successful consumption.
 */
export async function getOmadaCredentials(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token } = req.body as { token?: string };

    if (!token || typeof token !== 'string') {
      res.status(400).json({ success: false, error: 'Missing token' });
      return;
    }

    // Consume the token — validates expiry, single-use, and invalidates it.
    const tokenData = await radiusService.consumeOmadaPortalToken(token);

    if (!tokenData) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    // Look up the session to verify it's active or payment is completed.
    const session = await prisma.session.findUnique({
      where: { id: tokenData.sessionId },
      select: {
        id: true,
        status: true,
        hotspotUsername: true,
        payment: { select: { status: true } },
      },
    });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Only return credentials if the session is ACTIVE or payment is COMPLETED.
    if (session.status !== 'ACTIVE' && session.payment?.status !== 'COMPLETED') {
      res.status(402).json({ success: false, error: 'Payment not confirmed' });
      return;
    }

    // Get the RADIUS credentials for this session.
    const credentials = await radiusService.getRadiusUserBySession(session.id);

    if (!credentials) {
      res.status(404).json({ success: false, error: 'RADIUS credentials not found' });
      return;
    }

    // Return the credentials. The Custom Portal Page will use these to
    // auto-submit to the Omada Controller's /portal/radius/auth endpoint.
    // Note: The token has already been invalidated — this response is one-time.
    res.json({
      success: true,
      data: {
        username: credentials.username,
        password: credentials.password,
      },
    });
  } catch (err) {
    next(err);
  }
}
