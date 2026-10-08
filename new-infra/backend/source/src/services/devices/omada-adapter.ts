/**
 * OmadaAdapter — TP-Link Omada EAP adapter.
 *
 * Honest scope (Phase 5C, device pending re-test):
 * - Standalone EAPs expose a web UI (HTTP/HTTPS) and can sometimes be probed
 *   for model/firmware, but there is NO documented standalone management API.
 * - Omada SDN controller adoption uses a proprietary discovery protocol
 *   (UDP 29810–29814) and the controller API for adoption/SSID/portal config.
 *   A controller client is NOT implemented — no fake API.
 * - Where the EAP is controller-adopted, provisioning requires the controller
 *   path (controller credentials modeled as encrypted installation secrets).
 *
 * Therefore: discover()/identify()/diagnose() do real TCP/HTTP probing;
 * provision()/verify() return CONTROLLER_REQUIRED/UNSUPPORTED — never pretend.
 */

import net from 'net';
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
} from './device-adapter';

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: timeoutMs }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(false));
  });
}

async function probeHttp(host: string, timeoutMs: number): Promise<{ status?: number; server?: string; bodySnippet?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${host}/`, { redirect: 'manual', signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    return {
      status: res.status,
      server: res.headers.get('server') ?? undefined,
      bodySnippet: text.slice(0, 400),
    };
  } catch {
    return {};
  }
}

export class OmadaAdapter implements DeviceAdapter {
  readonly vendor = 'omada';

  async discover(conn: AdapterConnection): Promise<DeviceState> {
    const timeout = conn.timeoutMs ?? 3000;
    const [http, https, ssh, omadaCtl] = await Promise.all([
      probeTcp(conn.host, 80, timeout),
      probeTcp(conn.host, 443, timeout),
      probeTcp(conn.host, 22, timeout),
      probeTcp(conn.host, 29811, timeout), // Omada device-mgmt port when open
    ]);
    if (!http && !https && !ssh) {
      throw new AdapterError('DEVICE_UNREACHABLE', `No management surface on ${conn.host} (80/443/22 all closed)`);
    }
    const web = http ? await probeHttp(conn.host, timeout) : {};
    // Omada standalone login pages typically identify as "TP-LINK" / "Omada" / "EAP"
    const identity: DeviceIdentity = {};
    const hint = `${web.server ?? ''} ${web.bodySnippet ?? ''}`;
    const modelMatch = hint.match(/EAP\s?\d+|Omada\s+\w+/i);
    if (modelMatch) identity.model = modelMatch[0];
    return {
      reachable: true,
      identity,
      metadata: {
        openPorts: { http, https, ssh, omadaCtl },
        httpStatus: web.status,
        note: 'Standalone probe only — serial/MAC require controller or label scan',
      },
    };
  }

  async identify(conn: AdapterConnection): Promise<DeviceIdentity> {
    const state = await this.discover(conn);
    return state.identity ?? {};
  }

  async getCapabilities(conn: AdapterConnection): Promise<DeviceCapabilities> {
    const state = await this.discover(conn);
    return {
      liveDiscovery: false,        // UDP discovery is controller-side, unimplemented
      hotspotConfiguration: false, // portal comes from controller/RADIUS, not the AP
      captivePortal: true,         // when adopted + configured via controller
      ssidConfiguration: true,     // via controller only
      directApi: false,
      requiresController: true,
      extra: { openPorts: state.metadata?.openPorts, probedModel: state.identity?.model },
    };
  }

  async getState(conn: AdapterConnection): Promise<DeviceState> {
    return this.discover(conn);
  }

  async provision(): Promise<ProvisionResult> {
    return {
      ok: false,
      steps: [{ step: 'provision', ok: false, detail: 'CONTROLLER_REQUIRED — no Omada controller client implemented; adopt via Omada Controller then configure RADIUS/portal there' }],
    };
  }

  async verify(conn: AdapterConnection): Promise<VerifyResult> {
    try {
      const state = await this.discover(conn);
      return {
        ok: state.reachable,
        checks: {
          reachable: state.reachable,
          httpResponding: Boolean((state.metadata?.openPorts as Record<string, boolean>)?.http),
        },
        detail: 'reachable only — SSID/portal verification requires controller',
      };
    } catch (err) {
      const code = err instanceof AdapterError ? err.code : 'DEVICE_UNREACHABLE';
      return { ok: false, checks: { reachable: false }, detail: code };
    }
  }

  async diagnose(conn: AdapterConnection): Promise<AdapterDiagnostics> {
    try {
      const state = await this.discover(conn);
      const ports = (state.metadata?.openPorts ?? {}) as Record<string, boolean>;
      return {
        reachable: true,
        checks: {
          reachable: true,
          httpUi: Boolean(ports.http || ports.https),
          ssh: Boolean(ports.ssh),
        },
        notes: ['Standalone probe — adoption state, SSID and portal config require the Omada Controller.'],
      };
    } catch (err) {
      const code = err instanceof AdapterError ? err.code : 'DEVICE_UNREACHABLE';
      return { reachable: false, checks: { reachable: false }, notes: [`${code} — check Ethernet/PoE, DHCP lease, and controller adoption state`] };
    }
  }
}
