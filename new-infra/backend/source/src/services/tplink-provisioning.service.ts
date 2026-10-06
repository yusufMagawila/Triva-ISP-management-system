import {
  generateProvisioningKey,
  generateRouterApiPassword,
} from './router-provisioning.service';

const TPLINK_SSH_USERNAME = 'root';

type TpLinkBootstrapRouter = {
  id: string;
  name: string;
  ipAddress: string;
  sshPort: number;
  username: string;
  passwordHash: string;
  hotspotName: string;
  provisioningKey: string | null;
};

type TpLinkSyncSession = {
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
};

type TpLinkRemovableSession = {
  id: string;
  macAddress: string;
  hotspotUsername: string;
};

function sanitizeShellLiteral(value: string): string {
  return value.replace(/["\\$`\r\n]/g, ' ').trim();
}

export function generateTpLinkProvisioningKey(): string {
  return generateProvisioningKey();
}

export function generateTpLinkSshUsername(): string {
  return TPLINK_SSH_USERNAME;
}

export function generateTpLinkSshPassword(): string {
  return generateRouterApiPassword();
}

export function buildTpLinkBootstrapUrls(router: TpLinkBootstrapRouter, apiUrl: string) {
  if (!router.provisioningKey) {
    throw new Error(`TP-Link router ${router.id} has no provisioning key`);
  }

  const encodedKey = encodeURIComponent(router.provisioningKey);
  const portalBaseUrl = `${apiUrl}/api/portal/tplink/${router.id}`;

  return {
    bootstrapUrl: `${apiUrl}/bootstrap/tplink/router/${encodedKey}`,
    bootstrapInfoUrl: `${apiUrl}/bootstrap/tplink/router/${encodedKey}/info`,
    heartbeatUrl: `${apiUrl}/bootstrap/tplink/heartbeat/${encodedKey}`,
    sessionSyncUrl: `${apiUrl}/bootstrap/tplink/sync/${encodedKey}`,
    portalBaseUrl,
    splashHtmlUrl: `${portalBaseUrl}/splash.html`,
  };
}

/**
 * Build the zero-touch bootstrap shell script for an OpenWrt-based TP-Link router.
 * Mirrors the MikroTik RouterOS bootstrap: self-registration, captive portal
 * install (nodogsplash), walled-garden allow-list, heartbeat + pull-sync cron jobs.
 */
export function buildTpLinkBootstrapScript(router: TpLinkBootstrapRouter, apiUrl: string): string {
  const urls = buildTpLinkBootstrapUrls(router, apiUrl);
  const routerName = sanitizeShellLiteral(router.name);
  const heartbeatUrl = urls.heartbeatUrl;
  const syncUrl = urls.sessionSyncUrl;
  const splashUrl = urls.splashHtmlUrl;

  return `#!/bin/sh
# TRIVA ZERO-TOUCH BOOTSTRAP (TP-Link / OpenWrt)
# Router asset: ${routerName}
# Provisioning key: ${router.provisioningKey}
# Control-plane IP: ${router.ipAddress}
#
# This bootstrap is server-driven. The router self-registers to TRIVA,
# keeps its captive portal splash fresh, and pulls paid-session changes.
# Requires: OpenWrt with opkg and internet access.

set -e

TRIVA_HEARTBEAT_URL="${heartbeatUrl}"
TRIVA_SYNC_URL="${syncUrl}"
TRIVA_SPLASH_URL="${splashUrl}"
TRIVA_DIR="/var/triva"
TRIVA_SESSION_DIR="$TRIVA_DIR/sessions"

echo "TRIVA bootstrap starting for ${routerName}"

mkdir -p "$TRIVA_DIR" "$TRIVA_SESSION_DIR"

# 1. Install required packages (idempotent)
if ! command -v ndsctl >/dev/null 2>&1; then
  opkg update
  opkg install nodogsplash curl ca-bundle || opkg install nodogsplash curl
fi

# 2. Detect LAN interface for the captive portal
LAN_IF="$(uci -q get network.lan.device || uci -q get network.lan.ifname || echo br-lan)"

# 3. Configure nodogsplash
uci -q delete nodogsplash.@nodogsplash[0] 2>/dev/null || true
uci add nodogsplash nodogsplash >/dev/null
uci set nodogsplash.@nodogsplash[-1].enabled='1'
uci set nodogsplash.@nodogsplash[-1].gatewayinterface="$LAN_IF"
uci set nodogsplash.@nodogsplash[-1].gatewayname='TRIVA WiFi'
uci set nodogsplash.@nodogsplash[-1].maxclients='250'
uci set nodogsplash.@nodogsplash[-1].preauthidletimeout='30'
uci set nodogsplash.@nodogsplash[-1].authidletimeout='120'
# Walled garden: TRIVA portal + payment hosts must stay reachable before login
uci add_list nodogsplash.@nodogsplash[-1].walledgarden_fqdn='pandabus.live'
uci add_list nodogsplash.@nodogsplash[-1].walledgarden_fqdn='triva.pandabus.live'
uci add_list nodogsplash.@nodogsplash[-1].walledgarden_fqdn='mongike.com'
uci add_list nodogsplash.@nodogsplash[-1].walledgarden_fqdn='*.mongike.com'
uci add_list nodogsplash.@nodogsplash[-1].users_to_router='allow tcp port 53'
uci add_list nodogsplash.@nodogsplash[-1].users_to_router='allow udp port 53'
uci add_list nodogsplash.@nodogsplash[-1].users_to_router='allow udp port 67'
uci commit nodogsplash

# 4. Install the TRIVA splash page
mkdir -p /etc/nodogsplash/htdocs
curl -sk "$TRIVA_SPLASH_URL" -o /etc/nodogsplash/htdocs/splash.html || \\
  logger -t triva "TRIVA splash.html fetch failed"

# 5. TRIVA sync script: pull paid-session changes and apply them
cat > /usr/bin/triva-sync.sh <<'SYNCEOF'
#!/bin/sh
SYNC_URL="__TRIVA_SYNC_URL__"
TMP="/tmp/triva-sync.$$"
if curl -sk "$SYNC_URL" -o "$TMP"; then
  sh "$TMP" || logger -t triva "TRIVA sync apply failed"
else
  logger -t triva "TRIVA sync fetch failed"
fi
rm -f "$TMP"
SYNCEOF
sed -i "s|__TRIVA_SYNC_URL__|$TRIVA_SYNC_URL|" /usr/bin/triva-sync.sh
chmod +x /usr/bin/triva-sync.sh

# 6. TRIVA expiry sweeper: deauth clients whose session marker expired
cat > /usr/bin/triva-expire.sh <<'EXPEOF'
#!/bin/sh
NOW="$(date +%s)"
for f in /var/triva/sessions/*; do
  [ -f "$f" ] || continue
  EXPIRY="$(cut -d' ' -f1 "$f")"
  MAC="$(cut -d' ' -f2 "$f")"
  if [ -n "$EXPIRY" ] && [ "$NOW" -ge "$EXPIRY" ]; then
    ndsctl deauth "$MAC" 2>/dev/null
    rm -f "$f"
    logger -t triva "TRIVA session expired for $MAC"
  fi
done
EXPEOF
chmod +x /usr/bin/triva-expire.sh

# 7. TRIVA heartbeat script
cat > /usr/bin/triva-heartbeat.sh <<'HBEOF'
#!/bin/sh
curl -sk "__TRIVA_HEARTBEAT_URL__" >/dev/null 2>&1 || logger -t triva "TRIVA heartbeat failed"
HBEOF
sed -i "s|__TRIVA_HEARTBEAT_URL__|$TRIVA_HEARTBEAT_URL|" /usr/bin/triva-heartbeat.sh
chmod +x /usr/bin/triva-heartbeat.sh

# 8. Cron jobs: heartbeat 1m; sync loop 4x15s per minute; expiry sweep 1m
CRON=/etc/crontabs/root
touch "$CRON"
sed -i '/triva-heartbeat/d;/triva-sync/d;/triva-expire/d' "$CRON"
echo '* * * * * /usr/bin/triva-heartbeat.sh' >> "$CRON"
echo '* * * * * /usr/bin/triva-sync.sh; sleep 15; /usr/bin/triva-sync.sh; sleep 15; /usr/bin/triva-sync.sh; sleep 15; /usr/bin/triva-sync.sh' >> "$CRON"
echo '* * * * * /usr/bin/triva-expire.sh' >> "$CRON"
/etc/init.d/cron enable
/etc/init.d/cron restart

# 9. Start nodogsplash
/etc/init.d/nodogsplash enable
/etc/init.d/nodogsplash restart || /etc/init.d/nodogsplash start

# 10. First check-in
/usr/bin/triva-heartbeat.sh
/usr/bin/triva-sync.sh || true

echo "TRIVA zero-touch bootstrap applied for ${routerName}"
echo "Captive portal (nodogsplash) is live; walled garden allows pandabus.live, triva.pandabus.live, mongike.com, *.mongike.com"
echo "The router will keep checking in to TRIVA automatically."
`;
}

/**
 * Build the pull-sync shell script: authorize pending paid sessions on
 * nodogsplash and deauthorize expired/disconnected ones, acking each activation.
 */
export function buildTpLinkSyncScript(
  router: { id: string; name: string; provisioningKey: string },
  apiUrl: string,
  pendingSessions: TpLinkSyncSession[],
  removableSessions: TpLinkRemovableSession[]
): string {
  const lines = [
    '#!/bin/sh',
    '# TRIVA HOTSPOT LIVE SYNC (TP-Link / OpenWrt)',
    `# Router: ${sanitizeShellLiteral(router.name)}`,
    `# Router ID: ${router.id}`,
    `# Pending activations: ${pendingSessions.length}`,
    `# Pending removals: ${removableSessions.length}`,
    'mkdir -p /var/triva/sessions',
    '',
  ];

  if (pendingSessions.length === 0 && removableSessions.length === 0) {
    lines.push('echo "TRIVA sync: no changes"');
    return lines.join('\n');
  }

  for (const session of pendingSessions) {
    const mac = sanitizeShellLiteral(session.macAddress);
    const durationMins = session.plan.durationMins;
    const dl = session.plan.downloadKbps ?? 0;
    const ul = session.plan.uploadKbps ?? session.plan.downloadKbps ?? 0;
    const ackUrl = `${apiUrl}/bootstrap/tplink/sync/${encodeURIComponent(router.provisioningKey)}/ack/${encodeURIComponent(session.id)}`;
    const sessionFile = `/var/triva/sessions/${sanitizeShellLiteral(session.id)}`;

    lines.push(`# Activate session ${session.id}`);
    lines.push(`if ndsctl auth "${mac}" ${durationMins} ${ul} ${dl}; then`);
    lines.push(`  echo "$(($(date +%s) + ${durationMins * 60})) ${mac}" > "${sessionFile}"`);
    lines.push(`  curl -sk "${ackUrl}" >/dev/null 2>&1 || logger -t triva "TRIVA sync ack failed for ${session.id}"`);
    lines.push('else');
    lines.push(`  logger -t triva "TRIVA auth failed for ${mac} (client may not be connected yet; will retry next sync)"`);
    lines.push('fi');
    lines.push('');
  }

  for (const session of removableSessions) {
    const mac = sanitizeShellLiteral(session.macAddress);
    const sessionFile = `/var/triva/sessions/${sanitizeShellLiteral(session.id)}`;
    lines.push(`# Remove session ${session.id}`);
    lines.push(`ndsctl deauth "${mac}" 2>/dev/null || true`);
    lines.push(`rm -f "${sessionFile}"`);
    lines.push('');
  }

  lines.push(`echo "TRIVA sync applied: ${pendingSessions.length} activation(s), ${removableSessions.length} removal(s)"`);
  return lines.join('\n');
}
