/**
 * DeviceAdapter — the vendor-neutral seam between the installation engine
 * and physical hardware.
 *
 * Every vendor adapter implements the same narrow surface. Adapters never
 * accept raw device commands — they expose typed operations only. All errors
 * are mapped to stable AdapterErrorCode values so installers get useful
 * diagnostics instead of transport noise.
 */

export type AdapterErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'DEVICE_UNREACHABLE'
  | 'UNSUPPORTED'
  | 'NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'CONTROLLER_REQUIRED'
  | 'TIMEOUT';

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface AdapterConnection {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  /** Encrypted credential reference (secret://…) — adapters resolve via secrets lib. */
  credentialRef?: string;
  /** Omada-style: controller base URL the device is adopted to. */
  controllerUrl?: string;
  timeoutMs?: number;
}

export interface DeviceIdentity {
  serialNumber?: string;
  macAddress?: string;
  model?: string;
  firmwareVersion?: string;
  identity?: string; // device hostname/identity string
}

export interface DeviceCapabilities {
  liveDiscovery: boolean;
  hotspotConfiguration: boolean;
  captivePortal: boolean;
  ssidConfiguration: boolean;
  directApi: boolean;
  requiresController: boolean;
  extra?: Record<string, unknown>;
}

export interface DeviceState {
  reachable: boolean;
  identity?: DeviceIdentity;
  uptime?: string;
  metadata?: Record<string, unknown>;
}

export interface ProvisionStepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface ProvisionResult {
  ok: boolean;
  steps: ProvisionStepResult[];
}

export interface VerifyResult {
  ok: boolean;
  checks: Record<string, boolean>;
  detail?: string;
}

export interface AdapterDiagnostics {
  reachable: boolean;
  checks: Record<string, boolean>;
  notes: string[];
}

export interface DeviceAdapter {
  readonly vendor: string;

  /** Prove the device is there and return what it exposes. */
  discover(conn: AdapterConnection): Promise<DeviceState>;
  /** Read the device's self-reported identity (serial/MAC/model/version). */
  identify(conn: AdapterConnection): Promise<DeviceIdentity>;
  /** Report what this device can do — BEFORE any configuration attempt. */
  getCapabilities(conn: AdapterConnection): Promise<DeviceCapabilities>;
  /** Read current state for read-back verification. */
  getState(conn: AdapterConnection): Promise<DeviceState>;
  /** Apply a validated, typed configuration. Never raw commands. */
  provision(conn: AdapterConnection, plan: Record<string, unknown>): Promise<ProvisionResult>;
  /** Verify resulting state matches intended state. */
  verify(conn: AdapterConnection): Promise<VerifyResult>;
  /** Structured diagnostic checks for the diagnostic assistant. */
  diagnose(conn: AdapterConnection): Promise<AdapterDiagnostics>;
}

/** Map a thrown adapter/service error into a stable installer-facing code. */
export function toAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const errno = (err as { errno?: string | number }).errno;
  const msg = err instanceof Error ? err.message : String(err);
  if (errno === 'CANTLOGIN' || /invalid|unauthorized|401/i.test(msg)) {
    return new AdapterError('AUTHENTICATION_FAILED', 'Device credentials rejected', { errno });
  }
  if (errno === 'SOCKTMOUT' || errno === 'TIMEOUT' || /timed?\s*out|timeout/i.test(msg)) {
    return new AdapterError('TIMEOUT', 'Device did not respond in time', { errno });
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|network/i.test(msg) || typeof errno === 'number') {
    return new AdapterError('DEVICE_UNREACHABLE', 'Device is not reachable', { errno, msg });
  }
  return new AdapterError('INVALID_RESPONSE', msg, { errno });
}
