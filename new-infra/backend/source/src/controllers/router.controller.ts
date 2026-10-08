import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createMikroTikService } from '../services/mikrotik.service';
import { getIO } from '../socket';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import {
  buildRouterBootstrapUrls,
  normalizeRouterMac,
  normalizeRouterSerial,
} from '../services/router-provisioning.service';
import { createMikrotikAsset, PlanLimitError } from '../services/device-registry.service';

export async function listRouters(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const routers = await prisma.router.findMany({
      where: tenantId ? { tenantId } : {},
      select: {
        id: true,
        name: true,
        ipAddress: true,
        apiPort: true,
        username: true,
        provisioningKey: true,
        serialNumber: true,
        hardwareMac: true,
        hotspotName: true,
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

export async function createRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { name, serialNumber, hardwareMac, hotspotName, location } = req.body as {
      name: string;
      serialNumber?: string;
      hardwareMac?: string;
      hotspotName?: string;
      location?: string;
    };

    const router = await createMikrotikAsset(tenantId, {
      name,
      serialNumber,
      hardwareMac,
      hotspotName,
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

export async function getRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    const router = await prisma.router.findFirst({
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

    // Omit password from response
    const { passwordHash: _, ...safeRouter } = router;
    res.json({ success: true, data: safeRouter });
  } catch (err) {
    next(err);
  }
}

export async function updateRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { name, location, hotspotName, serialNumber, hardwareMac } = req.body as {
      name?: string;
      location?: string;
      hotspotName?: string;
      serialNumber?: string;
      hardwareMac?: string;
    };

    const router = await prisma.router.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const updated = await prisma.router.update({
      where: { id },
      data: {
        name,
        location,
        hotspotName,
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

export async function deleteRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.router.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    await prisma.router.delete({ where: { id } });
    res.json({ success: true, message: 'Router deleted' });
  } catch (err) {
    next(err);
  }
}

export async function pingRouter(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.router.findFirst({
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

    await prisma.router.update({
      where: { id },
      data: { status: newStatus, lastSeenAt: online ? new Date() : undefined },
    });

    // Emit real-time status
    const io = getIO();
    io.to(`tenant:${router.tenantId}`).emit('router:status', { routerId: id, status: newStatus });

    res.json({ success: true, data: { status: newStatus, lastBootstrapAt: router.lastBootstrapAt } });
  } catch (err) {
    next(err);
  }
}

export async function getRouterActiveSessions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const router = await prisma.router.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: req.user!.tenantId! } : {}),
      },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const mikrotik = createMikroTikService(router);
    const activeSessions = await mikrotik.getActiveSessions(router.hotspotName);

    res.json({ success: true, data: activeSessions });
  } catch (err) {
    next(err);
  }
}

type RouterSetupDownloadRouter = {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  username: string;
  hotspotName: string;
  location: string | null;
};

function sanitizeSetupFileName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildRouterSetupInstaller(
  router: RouterSetupDownloadRouter,
  portalUrl: string,
  loginHtmlUrl: string,
  syncScriptUrl: string
): string {
  const hotspotName = escapeRouterOsString(router.hotspotName);
  const routerName = escapeRouterOsString(router.name);
  const routerEndpoint = escapeRouterOsString(`${router.ipAddress}:${router.apiPort}`);
  const installerComment = escapeRouterOsString(`TRIVA ${router.id}`);
  const escapedPortalUrl = escapeRouterOsString(portalUrl);
  const escapedLoginHtmlUrl = escapeRouterOsString(loginHtmlUrl);
  const escapedSyncScriptUrl = escapeRouterOsString(syncScriptUrl);
  const syncJobName = escapeRouterOsString(`triva-sync-${router.id.slice(0, 8)}`);
  const syncFileName = escapeRouterOsString(`triva-sync-${router.id.slice(0, 8)}.rsc`);

  return `# TRIVA MIKROTIK AUTO INSTALLER
# Router name: ${routerName}
# Router ID: ${router.id}
# Saved TRIVA endpoint: ${routerEndpoint}
# Intended use: TRIVA-prepared routers that already have internet and a Hotspot server.
#
# Before import:
# 1. Router already has internet access.
# 2. Hotspot server \"${hotspotName}\" already exists.
# 3. This installer enables TRIVA live sync, so paid sessions can go live even if direct inbound API is unavailable.
# 4. A public or forwarded API endpoint is still recommended for dashboard ping and direct management features.
#
# Run from MikroTik after upload:
# /import file-name=triva-${sanitizeSetupFileName(router.name)}-auto-installer.rsc

:if ([:len [/ip hotspot find where name="${hotspotName}"]] = 0) do={
  :error "TRIVA installer stopped: hotspot server ${hotspotName} not found. Create it first."
}

:local trivaHtmlDir "hotspot"
:if ([:len [/file find where name="flash/hotspot"]] > 0) do={
  :set trivaHtmlDir "flash/hotspot"
} else={
  :if ([:len [/file find where name="hotspot"]] > 0) do={
    :set trivaHtmlDir "hotspot"
  } else={
    :set trivaHtmlDir ""
  }
}

:if ([:len $trivaHtmlDir] = 0) do={
  :error "TRIVA installer stopped: hotspot directory not found. Run Hotspot setup first."
}

:local trivaHotspotProfile [/ip hotspot get [/ip hotspot find where name="${hotspotName}"] profile]
:if ([:len $trivaHotspotProfile] > 0) do={
  /ip hotspot profile set [find where name=$trivaHotspotProfile] login-by=http-pap,http-chap,cookie html-directory=$trivaHtmlDir
}

/ip service enable api
/ip service set api disabled=no port=8728

:do {
  /tool fetch mode=https url="${escapedLoginHtmlUrl}" dst-path=($trivaHtmlDir . "/login.html") check-certificate=no keep-result=yes
} on-error={
  :error "TRIVA installer stopped: failed to download login.html from ${escapedLoginHtmlUrl}"
}

:do {
  /tool fetch mode=https url="${escapedLoginHtmlUrl}" dst-path=($trivaHtmlDir . "/flogin.html") check-certificate=no keep-result=yes
} on-error={
  :error "TRIVA installer stopped: failed to download flogin.html from ${escapedLoginHtmlUrl}"
}

:do {
  /tool fetch mode=https url="${escapedLoginHtmlUrl}" dst-path=($trivaHtmlDir . "/rlogin.html") check-certificate=no keep-result=yes
} on-error={
  :error "TRIVA installer stopped: failed to download rlogin.html from ${escapedLoginHtmlUrl}"
}

/ip hotspot walled-garden remove [find where comment="${installerComment}"]
/ip hotspot walled-garden add action=allow disabled=no dst-host="trivaconnect.site" comment="${installerComment}"
/ip hotspot walled-garden add action=allow disabled=no dst-host="*.trivaconnect.site" comment="${installerComment}"
/ip hotspot walled-garden add action=allow disabled=no dst-host="anypaytanzania.com" comment="${installerComment}"
/ip hotspot walled-garden add action=allow disabled=no dst-host="*.anypaytanzania.com" comment="${installerComment}"

/ip hotspot walled-garden ip remove [find where comment="${installerComment}"]
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="trivaconnect.site" dst-port=443 comment="${installerComment}"
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="*.trivaconnect.site" dst-port=443 comment="${installerComment}"
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="anypaytanzania.com" dst-port=443 comment="${installerComment}"
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="*.anypaytanzania.com" dst-port=443 comment="${installerComment}"

/system script remove [find where name="${syncJobName}"]
/system script add name="${syncJobName}" policy=read,write,test,policy source={
  :local syncUrl "${escapedSyncScriptUrl}"
  :do {
    /tool fetch mode=https url=$syncUrl dst-path="${syncFileName}" keep-result=yes check-certificate=no
    /import file-name="${syncFileName}"
  } on-error={
    :log warning "TRIVA live sync fetch failed"
  }
}
/system scheduler remove [find where name="${syncJobName}"]
/system scheduler add name="${syncJobName}" interval=15s start-time=startup on-event="/system script run ${syncJobName}" comment="${installerComment}"

:do {
  /system script run "${syncJobName}"
} on-error={
  :put "TRIVA initial live sync failed. Scheduler will retry automatically."
}

:put "TRIVA installer complete for ${routerName}"
:put "Hotspot server expected: ${hotspotName}"
:put "Saved TRIVA API endpoint in dashboard: ${routerEndpoint}"
:put "TRIVA live sync installed: router will pull paid-session updates every 15 seconds"
:put "Portal URL: ${escapedPortalUrl}"
:put "Next: test redirect from a phone via http://neverssl.com, then complete one payment and confirm access goes live"
`;
}

function buildRouterSetupManual(
  router: RouterSetupDownloadRouter,
  portalUrl: string,
  apiUrl: string,
  loginHtmlUrl: string
): string {
  return `TRIVA ROUTER SETUP MANUAL
=========================

Router details
--------------
Router name: ${router.name}
Router ID: ${router.id}
Configured TRIVA API endpoint: ${router.ipAddress}:${router.apiPort}
Saved API username: ${router.username}
Hotspot server name to use: ${router.hotspotName}
Location: ${router.location ?? 'Not specified'}

TRIVA links for this router
---------------------------
Captive portal URL: ${portalUrl}
Hotspot login page download: ${loginHtmlUrl}
Backend/API host: ${apiUrl}

Critical network requirement
----------------------------
TRIVA backend runs on a public VPS.
TRIVA can only connect to MikroTik API if the saved router endpoint is reachable from the public internet.

Do NOT use private LAN IPs such as:
- 192.168.x.x
- 10.x.x.x
- 172.16.x.x to 172.31.x.x

unless your TRIVA backend is on the same private network, which it is not in normal deployments.

NAT and double NAT rule
-----------------------
If your MikroTik is behind an ISP router or another upstream NAT device, TRIVA must NOT be configured with the MikroTik private LAN IP.

Instead:
1. Keep the MikroTik on its private LAN IP internally.
2. Forward a public TCP port from the upstream router to MikroTik API.
3. Save the upstream public IP in TRIVA as Router IP.
4. Save the forwarded external port in TRIVA as API port.

Example
-------
Topology:
VPS -> Internet -> ISP Router (public IP 41.59.10.20) -> MikroTik (private IP 192.168.1.143)

Port forward on ISP router:
TCP 28728 -> 192.168.1.143:8728

Then save in TRIVA:
- Router IP: 41.59.10.20
- API port: 28728

This means TRIVA connects to 41.59.10.20:28728, and the upstream router forwards that to MikroTik 192.168.1.143:8728.

If the currently saved endpoint is private or unreachable
--------------------------------------------------------
Current saved TRIVA endpoint: ${router.ipAddress}:${router.apiPort}

If this is a private or unreachable address, TRIVA will never be able to connect from the VPS.
Delete this router entry in TRIVA and create it again using the reachable public IP and forwarded external port.

If there is CGNAT or no inbound public IP
-----------------------------------------
Direct TRIVA-to-MikroTik API connection will not work.
Use one of these before continuing:
- a real public IP or static IP
- upstream port forwarding on a reachable public IP
- a VPN or tunnel between the router network and the TRIVA VPS

Goal
----
Configure this MikroTik so guests land on the TRIVA captive portal and TRIVA can create hotspot users on this specific router.

Before you begin
----------------
1. Make sure the router already has working internet access.
2. Make sure the guest LAN interface or bridge already exists.
3. Decide which MikroTik interface or bridge will run Hotspot.
4. Keep the Hotspot server name exactly as: ${router.hotspotName}
5. Make sure the saved TRIVA API endpoint is the public or forwarded endpoint, not a private LAN IP.

Fast path for TRIVA-prepared routers
-----------------------------------
If this router was sold with TRIVA preparation already done, use the Auto Installer download from the dashboard first.
That installs the router-specific login pages, enables API internally on port 8728, adds the TRIVA walled-garden rules, and registers a recurring router-to-TRIVA live sync job.
With that live sync in place, paid sessions can still go live even when TRIVA cannot open the MikroTik API directly from the VPS.
If the installer cannot continue, use the steps below as the fallback manual path.

Part 1. Verify LAN interface and local MikroTik IP
--------------------------------------------------
Run these commands in MikroTik terminal:

/interface print
/interface bridge print
/ip address print

Write down:
- the interface or bridge that serves guest users
- the MikroTik private IP that the upstream port forward should point to

Part 2. Enable MikroTik API on the router
-----------------------------------------
Run on MikroTik:

/ip service enable api
/ip service set api port=8728

Note:
- The MikroTik internal API port is usually 8728.
- The API port saved in TRIVA may be a different external forwarded port.

Part 3. Configure public reachability if MikroTik is behind NAT
---------------------------------------------------------------
If MikroTik is behind another router:
1. Open the upstream ISP router.
2. Forward a public external TCP port to MikroTik private IP on port 8728.
3. Use that public IP and external port in TRIVA.

If MikroTik is directly on a public IP, no upstream port forward is needed.

Part 4. Confirm the API user matches TRIVA
------------------------------------------
TRIVA will connect with these saved router credentials:
- Username: ${router.username}
- Endpoint: ${router.ipAddress}:${router.apiPort}

If you change the MikroTik API user or the public endpoint, update the router record in TRIVA by recreating it with the correct values.

Part 5. Create or confirm the Hotspot server
--------------------------------------------
In Winbox/WebFig go to IP > Hotspot > Setup.

Use these values:
- Hotspot interface: your guest LAN interface or bridge
- Local address: the LAN IP already assigned to that interface
- Address pool: use the pool MikroTik suggests, or your own guest pool
- DNS name: leave empty if you do not have one
- Hotspot server name: ${router.hotspotName}

After setup, verify with:

/ip hotspot print
/ip hotspot profile print

You should see a hotspot server named ${router.hotspotName}.

Ensure the hotspot profile used by ${router.hotspotName} has:
- login-by includes http-pap or http-chap
- html-directory is exactly hotspot

You can enforce this with:

:local hs "${router.hotspotName}"
:local hp [/ip hotspot get [/ip hotspot find where name=$hs] profile]
/ip hotspot profile set [find where name=$hp] login-by=http-pap,http-chap,cookie html-directory=hotspot

Part 6. Install TRIVA hotspot login page
----------------------------------------
Download the router-specific login page directly from:
${loginHtmlUrl}

Then place it in MikroTik's hotspot folder as these files:
- hotspot/login.html
- hotspot/flogin.html
- hotspot/rlogin.html

If your router stores hotspot files under flash, use:
- flash/hotspot/login.html
- flash/hotspot/flogin.html
- flash/hotspot/rlogin.html

Recommended MikroTik command if HTTPS fetch works on the router:

/tool fetch mode=https url="${loginHtmlUrl}" dst-path="hotspot/login.html" check-certificate=no keep-result=yes
/tool fetch mode=https url="${loginHtmlUrl}" dst-path="hotspot/flogin.html" check-certificate=no keep-result=yes
/tool fetch mode=https url="${loginHtmlUrl}" dst-path="hotspot/rlogin.html" check-certificate=no keep-result=yes

If hotspot files are in flash/hotspot, use:

/tool fetch mode=https url="${loginHtmlUrl}" dst-path="flash/hotspot/login.html" check-certificate=no keep-result=yes
/tool fetch mode=https url="${loginHtmlUrl}" dst-path="flash/hotspot/flogin.html" check-certificate=no keep-result=yes
/tool fetch mode=https url="${loginHtmlUrl}" dst-path="flash/hotspot/rlogin.html" check-certificate=no keep-result=yes

If fetch does not work, open the URL in a browser, save the HTML file, and upload it through Files in Winbox.

Part 7. Add TRIVA walled garden rules
-------------------------------------
Allow these hosts before login:
- trivaconnect.site
- *.trivaconnect.site
- anypaytanzania.com
- *.anypaytanzania.com

In Winbox/WebFig:
1. Go to IP > Hotspot > Walled Garden
2. Add host rules for the domains above
3. Go to IP > Hotspot > Walled Garden IP
4. Add HTTPS allow rules for the same hosts on TCP port 443

Part 8. Test from a phone or laptop
-----------------------------------
1. Connect to the guest WiFi.
2. Open a normal HTTP page such as http://neverssl.com
3. Confirm you are redirected to: ${portalUrl}
4. Start a payment from the portal.
5. Confirm TRIVA creates a hotspot user on this router.

Part 9. Troubleshooting
-----------------------
If TRIVA cannot create sessions:
- Ping the router from TRIVA dashboard
- Verify the saved endpoint ${router.ipAddress}:${router.apiPort} is public and reachable from the VPS
- Verify upstream port forwarding exists if MikroTik is behind NAT
- Verify MikroTik API service is enabled on internal port 8728
- Verify the MikroTik username matches ${router.username}
- Verify the hotspot server name is exactly ${router.hotspotName}

If portal redirect fails:
- Confirm hotspot/login.html was replaced
- Confirm walled-garden rules exist
- Confirm the guest client is hitting the hotspot-enabled interface

If payment succeeds but internet does not start:
- Verify the router has the hotspot server name ${router.hotspotName}
- Check active hotspot users with /ip hotspot active print
- Check hotspot users with /ip hotspot user print

Success checklist
-----------------
[ ] Saved TRIVA endpoint ${router.ipAddress}:${router.apiPort} is publicly reachable from the VPS
[ ] If NAT is used, upstream port forwarding exists to MikroTik API
[ ] MikroTik API is enabled internally on port 8728
[ ] Hotspot server name is ${router.hotspotName}
[ ] TRIVA login page installed
[ ] Walled garden rules added
[ ] Guest device redirects to ${portalUrl}
`;
}

/**
 * GET /api/routers/:id/setup-script
 * Legacy endpoint retained only to direct callers to the zero-touch bootstrap flow.
 */
export async function getRouterSetupScript(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.user!.role === 'SUPER_ADMIN' ? undefined : req.user!.tenantId!;

    const router = await prisma.router.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });

    if (!router) {
      res.status(404).json({ success: false, error: 'Router not found' });
      return;
    }

    const apiUrl = process.env.APP_URL ?? 'https://triva.pandabus.live';
    const bootstrapUrls = buildRouterBootstrapUrls(router, apiUrl);
    res.status(410).json({
      success: false,
      error: 'Legacy setup scripts are deprecated. Use zero-touch bootstrap provisioning instead.',
      data: {
        provisioningKey: router.provisioningKey,
        bootstrapUrl: bootstrapUrls.bootstrapUrl,
        controlPlaneIp: router.ipAddress,
      },
    });
    return;
  } catch (err) {
    next(err);
  }
}
