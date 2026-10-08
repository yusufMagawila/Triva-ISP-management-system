/**
 * MikroTikAdapter — DeviceAdapter implementation over the RouterOS API
 * (via the existing MikroTikService / node-routeros path).
 *
 * Hardware-verified on RB952Ui-5ac2nD / RouterOS 6.49.12 (Phase 5B).
 * Capability reporting reflects RouterOS-version differences instead of
 * assuming uniform behavior.
 */

import { MikroTikService } from '../mikrotik.service';
import {
  AdapterConnection,
  AdapterDiagnostics,
  AdapterError,
  DeviceAdapter,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceState,
  ProvisionResult,
  VerifyResult,
  toAdapterError,
} from './device-adapter';

function serviceFor(conn: AdapterConnection): MikroTikService {
  if (!conn.username) throw new AdapterError('AUTHENTICATION_FAILED', 'API username required');
  return new MikroTikService({
    host: conn.host,
    port: conn.port ?? 8728,
    user: conn.username,
    password: conn.password ?? '',
  });
}

function parseMajorVersion(version?: string): number | undefined {
  const m = version?.match(/^(\d+)\./);
  return m ? Number(m[1]) : undefined;
}

export class MikroTikAdapter implements DeviceAdapter {
  readonly vendor = 'mikrotik';

  async discover(conn: AdapterConnection): Promise<DeviceState> {
    try {
      const svc = serviceFor(conn);
      const snap = await svc.getDiscoverySnapshot();
      return {
        reachable: true,
        identity: {
          serialNumber: snap.serialNumber ?? undefined,
          macAddress: snap.interfaces?.find((i) => i.macAddress)?.macAddress ?? undefined,
          model: snap.model ?? snap.boardName ?? undefined,
          firmwareVersion: snap.routerOsVersion ?? undefined,
          identity: snap.identity ?? undefined,
        },
        uptime: snap.uptime ?? undefined,
        metadata: { interfaces: snap.interfaces, ips: snap.ipAddresses, dhcpServers: snap.dhcpServers, hotspotServers: snap.hotspotServers },
      };
    } catch (err) {
      throw toAdapterError(err);
    }
  }

  async identify(conn: AdapterConnection): Promise<DeviceIdentity> {
    const state = await this.discover(conn);
    return state.identity ?? {};
  }

  async getCapabilities(conn: AdapterConnection): Promise<DeviceCapabilities> {
    const state = await this.discover(conn);
    const major = parseMajorVersion(state.identity?.firmwareVersion);
    return {
      liveDiscovery: true,
      hotspotConfiguration: true,
      captivePortal: true,
      ssidConfiguration: true,
      directApi: true,
      requiresController: false,
      extra: {
        routerOsVersion: state.identity?.firmwareVersion,
        restApi: major !== undefined ? major >= 7 : undefined, // /rest exists on v7.1+ only
        apiSsl: true,
      },
    };
  }

  async getState(conn: AdapterConnection): Promise<DeviceState> {
    return this.discover(conn);
  }

  /**
   * Apply a typed provisioning plan. Supported keys:
   *   hotspotServer: { name, interface, addressPool, profile }
   *   hotspotProfiles: [{ profileName, downloadKbps, uploadKbps }]
   *   managementBypass: { address }   // ip-binding — MUST precede hotspot enable
   * Anything else is rejected — the adapter never executes raw commands.
   */
  async provision(conn: AdapterConnection, plan: Record<string, unknown>): Promise<ProvisionResult> {
    const allowed = ['hotspotServer', 'hotspotProfiles', 'managementBypass'];
    const unknown = Object.keys(plan).filter((k) => !allowed.includes(k));
    if (unknown.length) {
      return { ok: false, steps: [{ step: 'validate', ok: false, detail: `unsupported plan keys: ${unknown.join(', ')}` }] };
    }

    const svc = serviceFor(conn);
    const steps: ProvisionResult['steps'] = [];
    try {
      if (plan.managementBypass) {
        const b = plan.managementBypass as { address: string };
        await svc.addHotspotIpBinding(b.address, 'bypassed', 'triva-mgmt-bypass');
        steps.push({ step: 'managementBypass', ok: true, detail: b.address });
      }
      if (plan.hotspotServer) {
        const hs = plan.hotspotServer as { name: string; interface: string; addressPool?: string; profile?: string };
        await svc.createHotspotServer(hs.name, hs.interface, hs.addressPool, hs.profile);
        steps.push({ step: 'hotspotServer', ok: true, detail: hs.name });
      }
      for (const p of (plan.hotspotProfiles as Array<{ profileName: string; downloadKbps?: number; uploadKbps?: number }> | undefined) ?? []) {
        await svc.createOrUpdateProfile('', p.profileName, p.downloadKbps, p.uploadKbps);
        steps.push({ step: `hotspotProfile:${p.profileName}`, ok: true });
      }
      return { ok: steps.every((s) => s.ok), steps };
    } catch (err) {
      const ae = toAdapterError(err);
      steps.push({ step: 'failed', ok: false, detail: `${ae.code}: ${ae.message}` });
      return { ok: false, steps };
    }
  }

  async verify(conn: AdapterConnection): Promise<VerifyResult> {
    try {
      const state = await this.discover(conn);
      const checks: Record<string, boolean> = {
        reachable: true,
        hasIdentity: Boolean(state.identity?.serialNumber || state.identity?.macAddress),
        hasHotspotServer: Boolean((state.metadata?.hotspotServers as unknown[] | undefined)?.length),
      };
      return { ok: Object.values(checks).every(Boolean), checks };
    } catch (err) {
      const ae = toAdapterError(err);
      return { ok: false, checks: { reachable: false }, detail: `${ae.code}: ${ae.message}` };
    }
  }

  async diagnose(conn: AdapterConnection): Promise<AdapterDiagnostics> {
    const notes: string[] = [];
    try {
      const state = await this.discover(conn);
      const meta = state.metadata ?? {};
      return {
        reachable: true,
        checks: {
          apiReachable: true,
          identityReadable: Boolean(state.identity?.serialNumber),
          dhcpServerConfigured: Boolean((meta.dhcpServers as unknown[] | undefined)?.length),
          hotspotServerPresent: Boolean((meta.hotspotServers as unknown[] | undefined)?.length),
        },
        notes,
      };
    } catch (err) {
      const ae = toAdapterError(err);
      notes.push(`${ae.code}: ${ae.message}`);
      return { reachable: false, checks: { apiReachable: false }, notes };
    }
  }
}
