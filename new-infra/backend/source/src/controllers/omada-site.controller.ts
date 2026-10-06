import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { encryptRouterCredential, decryptRouterCredential } from '../lib/crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { getPlanConfig } from '../config/plans';
import { AuthRequest } from '../types';

/**
 * Dashboard controller for managing Omada sites.
 *
 * This mirrors the MikroTik router onboarding flow:
 *   1. Operator creates an Omada site asset in the dashboard
 *   2. TRIVA generates a per-site RADIUS shared secret
 *   3. Operator downloads the Custom Portal Page zip (with tenant ID baked in)
 *   4. Operator configures the Omada Controller UI using the provided settings
 *   5. The site shows online/offline status based on RADIUS auth activity
 */

function generateRadiusSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Upsert a NAS client in the FreeRADIUS nas table for this Omada site.
 * This allows per-site RADIUS shared secrets.
 * If controllerIp is not set, we use a wildcard (%) so any IP can authenticate.
 */
async function upsertNasClient(siteId: string, controllerIp: string | null | undefined, radiusSecretEnc: string | null, siteName: string): Promise<void> {
  const radiusSecret = radiusSecretEnc ? decryptRouterCredential(radiusSecretEnc) : '';
  if (!radiusSecret) return;
  const nasname = controllerIp || '%';
  // Use prisma.$executeRaw to upsert into the nas table
  await prisma.$executeRaw`
    INSERT INTO nas (nasname, shortname, type, secret, description)
    VALUES (${nasname}, ${'omada-' + siteName}, 'other', ${radiusSecret}, ${'Omada site: ' + siteName + ' (' + siteId + ')'})
    ON CONFLICT (nasname) DO UPDATE SET
      secret = EXCLUDED.secret,
      shortname = EXCLUDED.shortname,
      description = EXCLUDED.description
  `;
}

/**
 * Remove a NAS client when an Omada site is deleted.
 */
async function removeNasClient(controllerIp: string | null | undefined, siteId: string): Promise<void> {
  const nasname = controllerIp || '%';
  // Only remove if the description matches this site (avoid removing wildcard)
  await prisma.$executeRaw`
    DELETE FROM nas WHERE nasname = ${nasname} AND description LIKE ${'%' + siteId + '%'}
  `;
}

/**
 * List all Omada sites for the tenant.
 */
export async function listOmadaSites(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const where = { ...(tenantId ? { tenantId } : {}) };

    const sites = await prisma.omadaSite.findMany({
      where,
      include: { _count: { select: { sessions: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Add active session count
    const sitesWithStats = await Promise.all(
      sites.map(async (site) => {
        const activeSessions = await prisma.session.count({
          where: { omadaSiteId: site.id, status: 'ACTIVE' },
        });
        return {
          ...site,
          radiusSecret: undefined, // Don't expose secret in list view
          radiusSecretEnc: undefined,
          _count: {
            ...site._count,
            activeSessions,
          },
        };
      })
    );

    res.json({ success: true, data: sitesWithStats });
  } catch (err) {
    next(err);
  }
}

/**
 * Get a single Omada site with full details (including RADIUS secret).
 */
export async function getOmadaSite(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.tenantId! : undefined;

    const site = await prisma.omadaSite.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { _count: { select: { sessions: true } } },
    });

    if (!site) {
      res.status(404).json({ success: false, error: 'Omada site not found' });
      return;
    }

    const activeSessions = await prisma.session.count({
      where: { omadaSiteId: site.id, status: 'ACTIVE' },
    });

    res.json({
      success: true,
      data: {
        ...site,
        _count: { ...site._count, activeSessions },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new Omada site asset.
 *
 * Generates a per-site RADIUS shared secret that the operator will
 * enter into the Omada Controller's RADIUS server configuration.
 */
export async function createOmadaSite(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { name, controllerUrl, controllerIp, ssidName, hotspotName, location, tenantId: bodyTenantId } = req.body as {
      name: string;
      controllerUrl?: string;
      controllerIp?: string;
      ssidName?: string;
      hotspotName?: string;
      location?: string;
      tenantId?: string;
    };
    // Super admins can specify tenantId in the body; otherwise use the user's tenant
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (bodyTenantId || (req.query.tenantId as string | undefined))!
      : req.user!.tenantId!;
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'tenantId is required (specify it in the request body or query)' });
      return;
    }

    // Plan limit check (same as MikroTik routers)
    const tenantWithSub = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: true,
        _count: { select: { routers: true, tplinkRouters: true, omadaSites: true } },
      },
    });

    const planConfig = getPlanConfig(tenantWithSub?.subscription?.plan);
    const totalSites = (tenantWithSub?._count.routers ?? 0) +
                       (tenantWithSub?._count.tplinkRouters ?? 0) +
                       (tenantWithSub?._count.omadaSites ?? 0);
    if (planConfig.maxRouters !== -1 && totalSites >= planConfig.maxRouters) {
      res.status(403).json({
        success: false,
        error: `Your ${planConfig.label} plan allows a maximum of ${planConfig.maxRouters} site(s). Upgrade your subscription to add more.`,
        limitReached: true,
        currentPlan: tenantWithSub?.subscription?.plan,
      });
      return;
    }

    const radiusSecret = generateRadiusSecret();
    const radiusSecretEnc = encryptRouterCredential(radiusSecret);

    const site = await prisma.omadaSite.create({
      data: {
        tenantId,
        name,
        controllerUrl,
        controllerIp,
        radiusSecret,
        radiusSecretEnc,
        ssidName,
        hotspotName: hotspotName ?? 'omada1',
        location,
        status: 'OFFLINE',
      },
    });

    // Register the RADIUS client in the nas table
    await upsertNasClient(site.id, site.controllerIp, site.radiusSecretEnc, site.name).catch((err) => {
      logger.warn('Failed to register NAS client', { siteId: site.id, err });
    });

    logger.info('Omada site created', { siteId: site.id, tenantId });

    res.status(201).json({ success: true, data: site });
  } catch (err) {
    next(err);
  }
}

/**
 * Update an Omada site.
 */
export async function updateOmadaSite(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.tenantId! : undefined;
    const { name, controllerUrl, controllerIp, ssidName, location } = req.body as {
      name?: string;
      controllerUrl?: string;
      controllerIp?: string;
      ssidName?: string;
      location?: string;
    };

    const existing = await prisma.omadaSite.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Omada site not found' });
      return;
    }

    const updated = await prisma.omadaSite.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(controllerUrl !== undefined ? { controllerUrl } : {}),
        ...(controllerIp !== undefined ? { controllerIp } : {}),
        ...(ssidName !== undefined ? { ssidName } : {}),
        ...(location !== undefined ? { location } : {}),
      },
    });

    // Update NAS client if controllerIp or name changed
    if (controllerIp !== undefined || name !== undefined) {
      await upsertNasClient(updated.id, updated.controllerIp, updated.radiusSecretEnc, updated.name).catch((err) => {
        logger.warn('Failed to update NAS client', { siteId: updated.id, err });
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Mark an Omada site as provisioned (operator has finished Omada Controller config).
 */
export async function markOmadaSiteProvisioned(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.tenantId! : undefined;

    const existing = await prisma.omadaSite.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Omada site not found' });
      return;
    }

    const updated = await prisma.omadaSite.update({
      where: { id },
      data: { provisionedAt: new Date(), status: 'ONLINE' },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete an Omada site.
 */
export async function deleteOmadaSite(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.tenantId! : undefined;

    const existing = await prisma.omadaSite.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Omada site not found' });
      return;
    }

    // Remove the NAS client
    await removeNasClient(existing.controllerIp, id).catch((err) => {
      logger.warn('Failed to remove NAS client', { siteId: id, err });
    });

    await prisma.omadaSite.delete({ where: { id } });

    res.json({ success: true, message: 'Omada site deleted' });
  } catch (err) {
    next(err);
  }
}

/**
 * Download the Custom Portal Page zip for this site.
 *
 * This generates index.html + index.js with the site's tenant ID
 * and site ID baked in, then returns a zip file that the operator
 * uploads to the Omada Controller.
 *
 * GET /api/omada-sites/:id/portal-page
 */
export async function downloadPortalPage(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role !== 'SUPER_ADMIN' ? req.user!.tenantId! : undefined;

    const site = await prisma.omadaSite.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { tenant: { select: { name: true } } },
    });

    if (!site) {
      res.status(404).json({ success: false, error: 'Omada site not found' });
      return;
    }

    // Generate index.html (same as the static one)
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <meta http-equiv="pragma" content="no-cache" />
  <meta http-equiv="expires" content="0" />
  <title>${site.tenant.name} WiFi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 24px; padding: 40px 28px; max-width: 380px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; border-radius: 50%; background: rgba(59,130,246,.15); border: 2px solid rgba(59,130,246,.35); margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; font-size: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    .sub { color: #94a3b8; font-size: 14px; line-height: 1.65; margin-bottom: 24px; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,.1); border-top-color: #3b82f6; border-radius: 50%; margin: 0 auto; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { color: #ef4444; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" id="status-icon">&#x1F4F6;</div>
    <h1 id="status-title">Connecting...</h1>
    <p class="sub" id="status-message">Please wait while we connect you to the internet.</p>
    <div class="spinner" id="spinner"></div>
  </div>
  <script src="index.js"></script>
</body>
</html>`;

    // Generate index.js with site-specific config baked in
    const indexJs = generatePortalJs(site.id, site.tenantId, site.tenant.name);

    // Create the zip file in memory
    const zlib = await import('zlib');
    // We'll use a simple zip builder since we don't have archiver installed
    const zipBuffer = createSimpleZip([
      { name: 'index.html', content: indexHtml },
      { name: 'index.js', content: indexJs },
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="omada-portal-${site.name.replace(/[^a-z0-9]/gi, '-')}.zip"`);
    res.send(zipBuffer);

    logger.info('Omada portal page downloaded', { siteId: site.id, tenantId: site.tenantId });
  } catch (err) {
    next(err);
  }
}

/**
 * Generate the index.js content for a specific Omada site.
 * The tenant ID and site ID are baked in so the operator doesn't need
 * to manually edit any files.
 */
function generatePortalJs(siteId: string, tenantId: string, tenantName: string): string {
  return `/**
 * TRIVA Omada Custom Portal Page
 * Auto-generated for: ${tenantName}
 * Site ID: ${siteId}
 * Tenant ID: ${tenantId}
 *
 * Upload this zip (index.html + index.js) to the Omada Controller
 * as the Custom Portal Page for your SSID.
 */
(function () {
  'use strict';

  var TRIVA_PORTAL_URL = 'https://triva.pandabus.live/captive-portal-omada/';
  var TRIVA_CREDENTIALS_API = 'https://triva.pandabus.live/api/portal/omada/credentials';
  var TRIVA_TENANT_ID = '${tenantId}';
  var TRIVA_SITE_ID = '${siteId}';

  var params = {};
  var queryString = window.location.search.substring(1);
  var regex = /([^&=]+)=?([^&]*)/g;
  var match;
  while ((match = regex.exec(queryString)) !== null) {
    try { params[decodeURIComponent(match[1])] = decodeURIComponent(match[2]); }
    catch (e) { params[match[1]] = match[2]; }
  }

  var clientMac = params.clientMac || '';
  var apMac = params.apMac || '';
  var gatewayMac = params.gatewayMac || '';
  var ssidName = params.ssidName || '';
  var radioId = params.radioId || '';
  var vid = params.vid || '';
  var originUrl = params.originUrl || '';
  var trivaToken = params.triva_token || '';

  function setStatus(icon, title, message, isError) {
    var iconEl = document.getElementById('status-icon');
    var titleEl = document.getElementById('status-title');
    var msgEl = document.getElementById('status-message');
    var spinnerEl = document.getElementById('spinner');
    iconEl.innerHTML = icon;
    titleEl.textContent = title;
    msgEl.textContent = message;
    msgEl.className = 'sub' + (isError ? ' error' : '');
    if (isError) { spinnerEl.className = 'hidden'; }
  }

  if (!trivaToken) {
    var portalUrl = new URL(TRIVA_PORTAL_URL);
    portalUrl.searchParams.set('vendor', 'omada');
    portalUrl.searchParams.set('tenantId', TRIVA_TENANT_ID);
    portalUrl.searchParams.set('siteId', TRIVA_SITE_ID);
    if (clientMac) portalUrl.searchParams.set('mac', clientMac);
    if (apMac) portalUrl.searchParams.set('apMac', apMac);
    if (gatewayMac) portalUrl.searchParams.set('gatewayMac', gatewayMac);
    if (ssidName) portalUrl.searchParams.set('ssidName', ssidName);
    if (radioId) portalUrl.searchParams.set('radioId', radioId);
    if (vid) portalUrl.searchParams.set('vid', vid);
    if (originUrl) portalUrl.searchParams.set('originUrl', originUrl);
    portalUrl.searchParams.set('omadaUrl', window.location.href);
    window.location.replace(portalUrl.toString());
    return;
  }

  setStatus('&#x1F504;', 'Authenticating...', 'Verifying your payment. Please wait.');

  fetch(TRIVA_CREDENTIALS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: trivaToken }),
  })
    .then(function (response) { return response.json(); })
    .then(function (data) {
      if (!data.success || !data.data || !data.data.username || !data.data.password) {
        throw new Error('Invalid response from server');
      }
      submitRadiusAuth(data.data.username, data.data.password);
    })
    .catch(function (err) {
      setStatus('&#x26A0;', 'Authentication Failed', 'Your session may have expired. Please reconnect to WiFi to try again.', true);
    });

  function submitRadiusAuth(username, password) {
    setStatus('&#x2705;', 'Connecting...', 'Authenticating with the network.');
    var authData = { authType: 8, username: username, password: password, clientMac: clientMac, apMac: apMac, gatewayMac: gatewayMac || undefined, ssidName: ssidName, radioId: radioId ? Number(radioId) : undefined, vid: vid ? Number(vid) : undefined };
    Object.keys(authData).forEach(function (key) { if (authData[key] === undefined) delete authData[key]; });
    fetch('/portal/radius/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authData) })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data && data.errorCode === 0) {
          setStatus('&#x2705;', 'Connected!', 'You are now online. You can close this page.');
        } else {
          setStatus('&#x26A0;', 'Authentication Failed', getOmadaErrorMessage(data ? data.errorCode : -1), true);
        }
      })
      .catch(function (err) { submitRadiusAuthViaForm(username, password); });
  }

  function submitRadiusAuthViaForm(username, password) {
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = '/portal/radius/auth';
    var fields = { authType: '8', username: username, password: password, clientMac: clientMac, apMac: apMac, ssidName: ssidName };
    if (gatewayMac) fields.gatewayMac = gatewayMac;
    if (radioId) fields.radioId = radioId;
    if (vid) fields.vid = vid;
    Object.keys(fields).forEach(function (key) {
      var input = document.createElement('input');
      input.type = 'hidden'; input.name = key; input.value = fields[key];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function getOmadaErrorMessage(errorCode) {
    var messages = { 0: 'Success', '-1': 'General error. Please try again.', '-41500': 'Invalid authentication type.', '-41501': 'Failed to authenticate.', '-41524': 'Authentication failed: username does not exist.', '-41525': 'Authentication failed: wrong password.', '-41529': 'Incorrect username or password.', '-41530': 'RADIUS server timeout. Please try again later.' };
    return messages[errorCode] || 'Authentication failed (error ' + errorCode + '). Please try again.';
  }
})();`;
}

/**
 * Create a minimal ZIP file in memory (no external dependencies).
 * Supports uncompressed entries with a central directory.
 */
function createSimpleZip(files: Array<{ name: string; content: string }>): Buffer {
  // We'll use the built-in zlib for deflate, but for simplicity
  // and maximum compatibility with the Omada Controller's zip parser,
  // we'll use STORE (no compression) method.
  const entries: Array<{
    name: Buffer;
    data: Buffer;
    crc: number;
    localHeaderOffset: number;
  }> = [];

  let offset = 0;
  const localHeaders: Buffer[] = [];
  const fileData: Buffer[] = [];

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.from(file.content, 'utf8');
    const crc = crc32(dataBuf);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method (0 = STORE)
    localHeader.writeUInt16LE(0, 10); // File last modification time
    localHeader.writeUInt16LE(0, 12); // File last modification date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(dataBuf.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    entries.push({
      name: nameBuf,
      data: dataBuf,
      crc,
      localHeaderOffset: offset,
    });

    localHeaders.push(localHeader);
    fileData.push(dataBuf);
    offset += localHeader.length + dataBuf.length;
  }

  // Central directory
  const centralHeaders: Buffer[] = [];
  let centralDirSize = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const centralHeader = Buffer.alloc(46 + entry.name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // Compression method (0 = STORE)
    centralHeader.writeUInt16LE(0, 12); // File last modification time
    centralHeader.writeUInt16LE(0, 14); // File last modification date
    centralHeader.writeUInt32LE(entry.crc, 16); // CRC-32
    centralHeader.writeUInt32LE(entry.data.length, 20); // Compressed size
    centralHeader.writeUInt32LE(entry.data.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(entry.name.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(entry.localHeaderOffset, 42); // Relative offset of local header
    entry.name.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    centralDirSize += centralHeader.length;
  }

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  // Combine all parts
  return Buffer.concat([
    ...localHeaders.flatMap((h, i) => [h, fileData[i]]),
    ...centralHeaders,
    eocd,
  ]);
}

/**
 * CRC-32 calculation (IEEE polynomial).
 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
