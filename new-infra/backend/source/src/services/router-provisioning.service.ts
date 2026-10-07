import crypto from 'crypto';
import { prisma } from '../config/prisma';

const CONTROL_PLANE_PREFIX = '10.251';
const ROUTER_API_USERNAME = 'triva-agent';

type BootstrapRouter = {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  username: string;
  passwordHash: string;
  hotspotName: string;
  provisioningKey: string | null;
  updatedAt: Date;
};

function sanitizeRouterOsLiteral(value: string): string {
  return value.replace(/["\\\r\n]/g, ' ').trim();
}

export function generateProvisioningKey(): string {
  return `trk_${crypto.randomBytes(18).toString('base64url')}`;
}

export function generateRouterApiUsername(): string {
  return ROUTER_API_USERNAME;
}

export function generateRouterApiPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function normalizeRouterSerial(serial?: string | null): string | undefined {
  const value = serial?.trim().toUpperCase();
  return value ? value : undefined;
}

export function normalizeRouterMac(macAddress?: string | null): string | undefined {
  const normalized = macAddress?.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (!normalized) return undefined;
  if (normalized.length !== 12) return undefined;
  return normalized.match(/.{2}/g)?.join(':');
}

export async function allocateNextRouterControlIp(): Promise<string> {
  // The control-plane pool is shared between MikroTik and TP-Link routers.
  const [existingMikrotik, existingTpLink] = await Promise.all([
    prisma.router.findMany({
      where: {
        ipAddress: {
          startsWith: `${CONTROL_PLANE_PREFIX}.`,
        },
      },
      select: { ipAddress: true },
    }),
    prisma.tpLinkRouter.findMany({
      where: {
        ipAddress: {
          startsWith: `${CONTROL_PLANE_PREFIX}.`,
        },
      },
      select: { ipAddress: true },
    }),
  ]);
  const existing = [...existingMikrotik, ...existingTpLink];

  const usedHosts = new Set<number>();
  for (const router of existing) {
    const match = router.ipAddress.match(/^10\.251\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) continue;
    const thirdOctet = Number(match[1]);
    const fourthOctet = Number(match[2]);
    usedHosts.add(thirdOctet * 256 + fourthOctet);
  }

  for (let host = 10; host < 65535; host += 1) {
    if (usedHosts.has(host)) continue;
    const thirdOctet = Math.floor(host / 256);
    const fourthOctet = host % 256;
    return `${CONTROL_PLANE_PREFIX}.${thirdOctet}.${fourthOctet}`;
  }

  throw new Error('No control-plane IPs left in the TRIVA router pool');
}

export function buildRouterBootstrapUrls(router: BootstrapRouter, apiUrl: string) {
  if (!router.provisioningKey) {
    throw new Error(`Router ${router.id} has no provisioning key`);
  }

  const encodedKey = encodeURIComponent(router.provisioningKey);
  const portalBaseUrl = `${apiUrl}/api/portal/router/${router.id}/hotspot`;

  return {
    bootstrapUrl: `${apiUrl}/bootstrap/router/${encodedKey}`,
    bootstrapInfoUrl: `${apiUrl}/bootstrap/router/${encodedKey}/info`,
    heartbeatUrl: `${apiUrl}/bootstrap/heartbeat/${encodedKey}`,
    sessionSyncUrl: `${apiUrl}/bootstrap/sync/${encodedKey}`,
    portalBaseUrl,
    loginHtmlUrl: `${portalBaseUrl}/login.html`,
  };
}

export function buildRouterBootstrapScript(router: BootstrapRouter, apiUrl: string): string {
  const urls = buildRouterBootstrapUrls(router, apiUrl);
  const routerName = sanitizeRouterOsLiteral(router.name);
  const apiUsername = sanitizeRouterOsLiteral(router.username);
  const apiPassword = sanitizeRouterOsLiteral(router.passwordHash);
  const hotspotName = sanitizeRouterOsLiteral(router.hotspotName);
  const heartbeatUrl = urls.heartbeatUrl;
  const syncScriptUrl = urls.sessionSyncUrl;
  const portalBaseUrl = urls.portalBaseUrl;
  const ruleTag = sanitizeRouterOsLiteral(`TRIVA bootstrap ${router.id}`);

  return `# TRIVA ZERO-TOUCH BOOTSTRAP
# Router asset: ${routerName}
# Provisioning key: ${router.provisioningKey}
# Control-plane IP: ${router.ipAddress}
# Hotspot server: ${hotspotName}
#
# This bootstrap is server-driven. The router self-registers to TRIVA,
# keeps its captive portal files fresh, and pulls paid-session changes.

:local trivaPortalBase "${portalBaseUrl}"
:local trivaHeartbeatUrl "${heartbeatUrl}"
:local trivaSyncUrl "${syncScriptUrl}"
:local trivaHotspotName "${hotspotName}"
:local trivaRuleTag "${ruleTag}"
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

:local trivaHotspotServerId [/ip hotspot find where name=$trivaHotspotName]
:if ([:len $trivaHotspotServerId] > 0) do={
  :local trivaHotspotProfile [/ip hotspot get $trivaHotspotServerId profile]
  :if ([:len $trivaHotspotProfile] > 0) do={
    /ip hotspot profile set [find where name=$trivaHotspotProfile] login-by=http-pap,http-chap,cookie
    :if ([:len $trivaHtmlDir] > 0) do={
      /ip hotspot profile set [find where name=$trivaHotspotProfile] html-directory=$trivaHtmlDir
    }
  }
}

:if ([:len [/user find where name="${apiUsername}"]] = 0) do={
  /user add name="${apiUsername}" password="${apiPassword}" group=full comment="TRIVA bootstrap"
} else={
  /user set [/user find where name="${apiUsername}"] password="${apiPassword}" group=full comment="TRIVA bootstrap"
}

/ip service enable api
/ip service set api disabled=no port=${router.apiPort}

/ip hotspot walled-garden remove [find where comment=$trivaRuleTag]
/ip hotspot walled-garden add action=allow disabled=no dst-host="trivaconnect.site" comment=$trivaRuleTag
/ip hotspot walled-garden add action=allow disabled=no dst-host="*.trivaconnect.site" comment=$trivaRuleTag
/ip hotspot walled-garden add action=allow disabled=no dst-host="anypaytanzania.com" comment=$trivaRuleTag
/ip hotspot walled-garden add action=allow disabled=no dst-host="*.anypaytanzania.com" comment=$trivaRuleTag

/ip hotspot walled-garden ip remove [find where comment=$trivaRuleTag]
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="trivaconnect.site" dst-port=443 comment=$trivaRuleTag
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="*.trivaconnect.site" dst-port=443 comment=$trivaRuleTag
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="anypaytanzania.com" dst-port=443 comment=$trivaRuleTag
/ip hotspot walled-garden ip add action=accept disabled=no protocol=tcp dst-host="*.anypaytanzania.com" dst-port=443 comment=$trivaRuleTag

:if ([:len $trivaHtmlDir] > 0) do={
  :do {
    /tool fetch mode=https url=($trivaPortalBase . "/login.html") dst-path=($trivaHtmlDir . "/login.html") keep-result=yes check-certificate=no
  } on-error={
    :log warning "TRIVA portal login.html fetch failed"
  }
  :do {
    /tool fetch mode=https url=($trivaPortalBase . "/flogin.html") dst-path=($trivaHtmlDir . "/flogin.html") keep-result=yes check-certificate=no
  } on-error={
    :log warning "TRIVA portal flogin.html fetch failed"
  }
  :do {
    /tool fetch mode=https url=($trivaPortalBase . "/rlogin.html") dst-path=($trivaHtmlDir . "/rlogin.html") keep-result=yes check-certificate=no
  } on-error={
    :log warning "TRIVA portal rlogin.html fetch failed"
  }
}

/system script remove [find where name="triva-heartbeat"]
/system script add name="triva-heartbeat" policy=read,write,test source={
  :local hbUrl "${heartbeatUrl}"
  :do {
    /tool fetch mode=https url=$hbUrl keep-result=no check-certificate=no
  } on-error={
    :log warning "TRIVA heartbeat failed"
  }
}
/system scheduler remove [find where name="triva-heartbeat"]
/system scheduler add name="triva-heartbeat" interval=1m on-event="/system script run triva-heartbeat"

/system script remove [find where name="triva-sync"]
/system script add name="triva-sync" policy=read,write,test source={
  :local syncUrl "${syncScriptUrl}"
  :do {
    /tool fetch mode=https url=$syncUrl dst-path="triva-sync.rsc" keep-result=yes check-certificate=no
    /import file-name="triva-sync.rsc"
  } on-error={
    :log warning "TRIVA sync failed"
  }
}
/system scheduler remove [find where name="triva-sync"]
/system scheduler add name="triva-sync" interval=15s on-event="/system script run triva-sync"

:do { /system script run triva-heartbeat } on-error={ :log warning "TRIVA bootstrap heartbeat run failed" }
:do { /system script run triva-sync } on-error={ :log warning "TRIVA bootstrap session sync run failed" }

:put "TRIVA zero-touch bootstrap applied for ${routerName}"
:put "Hotspot allow-list installed for trivaconnect.site, *.trivaconnect.site, anypaytanzania.com, and *.anypaytanzania.com"
:put "The router will keep checking in to TRIVA automatically."
`;
}