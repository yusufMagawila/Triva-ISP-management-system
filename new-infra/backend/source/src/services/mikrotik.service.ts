// node-routeros uses CommonJS exports — use require to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RouterOSAPI } = require('node-routeros');
import { decryptRouterCredential } from '../lib/crypto';
import { MikroTikConfig, HotspotUser, HotspotActive, RouterOSResponse, RouterDiscoverySnapshot } from '../types';
import { logger } from '../config/logger';

export class MikroTikService {
  private config: MikroTikConfig;

  constructor(config: MikroTikConfig) {
    this.config = config;
  }

  private async connect(): Promise<any> {
    const api = new RouterOSAPI({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      timeout: 10,
    });

    await api.connect();
    return api;
  }

  async testConnection(): Promise<boolean> {
    let api: any = null;
    try {
      api = await this.connect();
      await api.write('/system/identity/print');
      return true;
    } catch (err) {
      logger.error('MikroTik connection test failed', { host: this.config.host, err });
      return false;
    } finally {
      if (api) await api.close();
    }
  }

  async getSystemIdentity(): Promise<string> {
    let api: any = null;
    try {
      api = await this.connect();
      const result = (await api.write('/system/identity/print')) as RouterOSResponse[];
      return result[0]?.name ?? 'Unknown';
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Read the router's actual state — "what is on this router right now?"
   * Used by the installation engine before proposing changes.
   *
   * Requires the RouterOS API to be reachable from the backend (public IP,
   * port forward, or tunnel). Routers behind NAT without forwarding rely on
   * heartbeat-reported identity instead; this call will throw/fail there.
   */
  async getDiscoverySnapshot(): Promise<RouterDiscoverySnapshot> {
    let api: any = null;
    try {
      api = await this.connect();

      const [identity, resource, routerboard, interfaces, ipAddresses, dhcpServers, dhcpLeases, hotspotServers] =
        await Promise.all([
          api.write('/system/identity/print') as Promise<RouterOSResponse[]>,
          api.write('/system/resource/print') as Promise<RouterOSResponse[]>,
          api.write('/system/routerboard/print').catch(() => [] as RouterOSResponse[]),
          api.write('/interface/print') as Promise<RouterOSResponse[]>,
          api.write('/ip/address/print') as Promise<RouterOSResponse[]>,
          api.write('/ip/dhcp-server/print').catch(() => [] as RouterOSResponse[]),
          api.write('/ip/dhcp-server/lease/print', ['?dynamic=yes']).catch(() => [] as RouterOSResponse[]),
          api.write('/ip/hotspot/print').catch(() => [] as RouterOSResponse[]),
        ]);

      const res0 = resource[0] ?? {};
      const rb0 = routerboard[0] ?? {};

      return {
        live: true,
        identity: identity[0]?.name ?? null,
        model: rb0['model'] ?? res0['board-name'] ?? null,
        serialNumber: rb0['serial-number'] ?? null,
        routerOsVersion: res0['version'] ?? null,
        boardName: res0['board-name'] ?? null,
        uptime: res0['uptime'] ?? null,
        cpuLoad: res0['cpu-load'] ?? null,
        interfaces: interfaces.map((i) => ({
          name: i['name'] ?? '',
          type: i['type'] ?? '',
          running: i['running'] === 'true',
          macAddress: i['mac-address'] ?? null,
        })),
        ipAddresses: ipAddresses.map((a) => ({
          address: a['address'] ?? '',
          interface: a['interface'] ?? '',
          network: a['network'] ?? '',
        })),
        dhcpServers: dhcpServers.map((d: RouterOSResponse) => ({
          name: d['name'] ?? '',
          interface: d['interface'] ?? '',
          addressPool: d['address-pool'] ?? '',
          disabled: d['disabled'] === 'true',
        })),
        dhcpLeaseCount: dhcpLeases.length,
        hotspotServers: hotspotServers.map((h: RouterOSResponse) => ({
          name: h['name'] ?? '',
          interface: h['interface'] ?? '',
          profile: h['profile'] ?? '',
          disabled: h['disabled'] === 'true',
        })),
        capturedAt: new Date().toISOString(),
      };
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Add a hotspot user with time and/or bandwidth limits.
   */
  async addHotspotUser(hotspotName: string, user: HotspotUser): Promise<string> {
    let api: any = null;
    try {
      api = await this.connect();

      const params: string[] = [
        `=name=${user.name}`,
        `=password=${user.password}`,
        `=server=${hotspotName}`,
      ];

      if (user.profile) params.push(`=profile=${user.profile}`);
      if (user.macAddress) params.push(`=mac-address=${user.macAddress}`);
      if (user.limitUptime) params.push(`=limit-uptime=${user.limitUptime}`);
      if (user.limitBytesTotal) params.push(`=limit-bytes-total=${user.limitBytesTotal}`);
      if (user.comment) params.push(`=comment=${user.comment}`);

      const result = (await api.write('/ip/hotspot/user/add', params)) as RouterOSResponse[];
      const id = result[0]?.ret ?? '';
      logger.info('Hotspot user added', { hotspotName, username: user.name, id });
      return id;
    } catch (err) {
      logger.error('Failed to add hotspot user', { hotspotName, username: user.name, err });
      throw err;
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Remove a hotspot user by their name.
   */
  async removeHotspotUser(hotspotName: string, username: string): Promise<void> {
    let api: any = null;
    try {
      api = await this.connect();

      // Find user ID
      const users = (await api.write('/ip/hotspot/user/print', [
        `?server=${hotspotName}`,
        `?name=${username}`,
      ])) as RouterOSResponse[];

      for (const u of users) {
        if (u['.id']) {
          await api.write('/ip/hotspot/user/remove', [`=.id=${u['.id']}`]);
        }
      }

      logger.info('Hotspot user removed', { hotspotName, username });
    } catch (err) {
      logger.error('Failed to remove hotspot user', { hotspotName, username, err });
      throw err;
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Disconnect an active hotspot session by MAC address or username.
   */
  async disconnectHotspotSession(hotspotName: string, identifier: string): Promise<void> {
    let api: any = null;
    try {
      api = await this.connect();

      const active = (await api.write('/ip/hotspot/active/print', [
        `?server=${hotspotName}`,
      ])) as RouterOSResponse[];

      for (const session of active) {
        if (session.user === identifier || session['mac-address'] === identifier) {
          if (session['.id']) {
            await api.write('/ip/hotspot/active/remove', [`=.id=${session['.id']}`]);
          }
        }
      }

      logger.info('Hotspot session disconnected', { hotspotName, identifier });
    } catch (err) {
      logger.error('Failed to disconnect hotspot session', { hotspotName, identifier, err });
      throw err;
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Get all currently active hotspot sessions.
   */
  async getActiveSessions(hotspotName: string): Promise<HotspotActive[]> {
    let api: any = null;
    try {
      api = await this.connect();

      const active = (await api.write('/ip/hotspot/active/print', [
        `?server=${hotspotName}`,
      ])) as RouterOSResponse[];

      return active.map((s) => ({
        id: s['.id'] ?? '',
        user: s.user ?? '',
        address: s.address ?? '',
        macAddress: s['mac-address'] ?? '',
        uptime: s.uptime ?? '0s',
        bytesIn: s['bytes-in'] ?? '0',
        bytesOut: s['bytes-out'] ?? '0',
      }));
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Create a hotspot user profile with speed limits.
   */
  async createOrUpdateProfile(
    hotspotName: string,
    profileName: string,
    downloadKbps?: number,
    uploadKbps?: number
  ): Promise<void> {
    let api: any = null;
    try {
      api = await this.connect();

      const existing = (await api.write('/ip/hotspot/user/profile/print', [
        `?name=${profileName}`,
      ])) as RouterOSResponse[];

      const params = [
        `=name=${profileName}`,
        `=shared-users=1`,
      ];

      if (downloadKbps) {
        // MikroTik rate-limit format: download/upload in bits/s
        const dl = `${downloadKbps}k`;
        const ul = uploadKbps ? `${uploadKbps}k` : `${downloadKbps}k`;
        params.push(`=rate-limit=${ul}/${dl}`);
      }

      if (existing.length > 0 && existing[0]['.id']) {
        params.unshift(`=.id=${existing[0]['.id']}`);
        await api.write('/ip/hotspot/user/profile/set', params);
      } else {
        await api.write('/ip/hotspot/user/profile/add', params);
      }

      logger.info('Hotspot profile created/updated', { profileName, downloadKbps, uploadKbps });
    } finally {
      if (api) await api.close();
    }
  }

  /**
   * Convert minutes to MikroTik uptime string format (hh:mm:ss).
   */
  static minutesToUptime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
  }
}

// Factory to create a MikroTikService from a Router DB record
export function createMikroTikService(router: {
  ipAddress: string;
  apiPort: number;
  username: string;
  passwordHash: string;
  passwordEnc?: string | null;
}): MikroTikService {
  const password = router.passwordEnc
    ? decryptRouterCredential(router.passwordEnc)
    : router.passwordHash;
  return new MikroTikService({
    host: router.ipAddress,
    port: router.apiPort,
    user: router.username,
    password,
  });
}
