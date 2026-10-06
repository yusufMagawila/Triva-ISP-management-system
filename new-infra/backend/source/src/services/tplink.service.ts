// ssh2 uses CommonJS exports — use require to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('ssh2');
import { decryptRouterCredential } from '../lib/crypto';
import { HotspotUser, HotspotActive, TpLinkConfig } from '../types';
import { logger } from '../config/logger';

const SESSION_DIR = '/var/triva/sessions';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Device driver for TP-Link routers running OpenWrt + nodogsplash.
 * Direct SSH push is a best-effort fast path; routers behind NAT fall back
 * to the pull-sync loop (same design philosophy as the MikroTik service).
 */
export class TpLinkService {
  private config: TpLinkConfig;

  constructor(config: TpLinkConfig) {
    this.config = config;
  }

  private exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error('SSH command timed out'));
      }, 15_000);

      conn
        .on('ready', () => {
          conn.exec(command, (err: Error | undefined, stream: any) => {
            if (err) {
              clearTimeout(timer);
              conn.end();
              reject(err);
              return;
            }
            stream
              .on('close', () => {
                clearTimeout(timer);
                conn.end();
                resolve(output);
              })
              .on('data', (data: Buffer) => {
                output += data.toString();
              })
              .stderr.on('data', (data: Buffer) => {
                output += data.toString();
              });
          });
        })
        .on('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        })
        .connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.user,
          password: this.config.password,
          readyTimeout: 10_000,
        });
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const out = await this.exec('echo ok');
      return out.trim().includes('ok');
    } catch (err) {
      logger.error('TP-Link SSH connection test failed', { host: this.config.host, err });
      return false;
    }
  }

  async getSystemIdentity(): Promise<string> {
    const out = await this.exec("uci get system.@system[0].hostname 2>/dev/null || cat /proc/sys/kernel/hostname");
    return out.trim() || 'Unknown';
  }

  /**
   * Authorize a client on nodogsplash with session timeout and rate limits.
   * user.limitUptime carries the session duration in minutes (stringified).
   */
  async addHotspotUser(_hotspotName: string, user: HotspotUser & { durationMins?: number; downloadKbps?: number; uploadKbps?: number }): Promise<string> {
    if (!user.macAddress) throw new Error('TP-Link activation requires a client MAC address');

    const durationSecs = (user.durationMins ?? 0) * 60;
    const dl = user.downloadKbps ?? 0;
    const ul = user.uploadKbps ?? user.downloadKbps ?? 0;
    const mac = shellQuote(user.macAddress);
    const sessionId = user.comment?.replace(/^session:/, '') ?? user.name;
    const expiryEpoch = `$(($(date +%s) + ${durationSecs}))`;

    const cmd = [
      `mkdir -p ${SESSION_DIR}`,
      `ndsctl auth ${mac} ${durationSecs > 0 ? Math.ceil(durationSecs / 60) : 0} ${ul} ${dl}`,
      `echo "${expiryEpoch} $(echo ${mac})" > ${SESSION_DIR}/${shellQuote(sessionId)}`,
    ].join(' && ');

    await this.exec(cmd);
    logger.info('TP-Link hotspot client authorized', { mac: user.macAddress, sessionId });
    return sessionId;
  }

  async removeHotspotUser(_hotspotName: string, username: string): Promise<void> {
    const sessionFile = `${SESSION_DIR}/*`;
    // Deauth by MAC recorded in the marker file matching this username is not
    // tracked; deauth is driven by MAC in disconnectHotspotSession. Clean markers.
    await this.exec(`for f in ${sessionFile}; do grep -l ${shellQuote(username)} "$f" 2>/dev/null | xargs -r rm -f; done; true`);
    logger.info('TP-Link hotspot user marker removed', { username });
  }

  async disconnectHotspotSession(_hotspotName: string, identifier: string): Promise<void> {
    await this.exec(`ndsctl deauth ${shellQuote(identifier)} || true`);
    logger.info('TP-Link hotspot client deauthorized', { identifier });
  }

  async getActiveSessions(_hotspotName: string): Promise<HotspotActive[]> {
    const out = await this.exec('ndsctl json 2>/dev/null || echo {}');
    try {
      const parsed = JSON.parse(out) as { clients?: Record<string, { ip?: string; mac?: string; duration?: number; downloaded?: number; uploaded?: number; token?: string }> };
      return Object.entries(parsed.clients ?? {}).map(([key, c]) => ({
        id: c.token ?? key,
        user: c.mac ?? key,
        address: c.ip ?? '',
        macAddress: c.mac ?? key,
        uptime: `${c.duration ?? 0}s`,
        bytesIn: String((c.downloaded ?? 0) * 1024),
        bytesOut: String((c.uploaded ?? 0) * 1024),
      }));
    } catch {
      return [];
    }
  }
}

// Factory to create a TpLinkService from a TpLinkRouter DB record
export function createTpLinkService(router: {
  ipAddress: string;
  sshPort: number;
  username: string;
  passwordHash: string;
  passwordEnc?: string | null;
}): TpLinkService {
  const password = router.passwordEnc
    ? decryptRouterCredential(router.passwordEnc)
    : router.passwordHash;
  return new TpLinkService({
    host: router.ipAddress,
    port: router.sshPort,
    user: router.username,
    password,
  });
}
