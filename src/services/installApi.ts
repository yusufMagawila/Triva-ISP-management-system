/**
 * Installer API client — the /api/install namespace.
 * All responses are { success, data } envelopes.
 */
import api from './api';

export interface Installation {
  id: string;
  status: string;
  stage?: string;
  siteId: string;
  installerId: string;
  createdAt: string;
  requestedConfig?: Record<string, unknown>;
  executionResults?: Array<{ actionId: string; type: string; status: string; error?: string; at: string }>;
  site?: { id: string; name: string; customer?: { id: string; name: string } | null };
  installer?: { id: string; name: string; email: string };
}

export interface DeviceRecord {
  id: string;
  vendor: string;
  deviceType: string;
  model?: string;
  serialNumber?: string;
  macAddress?: string;
  status: string;
  provisioningStatus: string;
  siteId?: string | null;
  site?: { id: string; name: string } | null;
}

export interface IdentifyResult {
  result: 'FOUND' | 'NOT_FOUND';
  identity: { serialNumber?: string; macAddress?: string; barcodeValue: string; vendorHint?: string; modelHint?: string };
  device: DeviceRecord | null;
  alreadyAssigned: boolean;
}

export interface InstallationPlan {
  planVersion: '1';
  summary: string;
  actions: Array<{ type: string; reason?: string; params?: Record<string, unknown> }>;
  warnings: string[];
  requiresApproval: boolean;
}

const unwrap = <T>(p: Promise<{ data: { success: boolean; data: T } }>) => p.then((r) => r.data.data);

export const installApi = {
  listInstallations: () => unwrap<Installation[]>(api.get('/install/installations')),
  getInstallation: (id: string) => unwrap<Installation>(api.get(`/install/installations/${id}`)),
  listSites: () => unwrap<Array<{ id: string; name: string }>>(api.get('/install/sites')),
  transition: (id: string, to: string, failureReason?: string) =>
    unwrap<Installation>(api.post(`/install/installations/${id}/transition`, { to, failureReason })),

  identifyDevice: (payload: string) => unwrap<IdentifyResult>(api.post('/install/devices/identify', { payload })),
  registerDevice: (body: Record<string, unknown>) => unwrap<DeviceRecord>(api.post('/install/devices/register', body)),
  listDevices: (params?: Record<string, string>) => unwrap<DeviceRecord[]>(api.get('/install/devices', { params })),
  assignDevice: (id: string, siteId: string, installationId?: string) =>
    unwrap<DeviceRecord>(api.post(`/install/devices/${id}/assign`, { siteId, installationId })),
  reassignDevice: (id: string, siteId: string, reason: string) =>
    unwrap<DeviceRecord>(api.post(`/install/devices/${id}/reassign`, { siteId, reason })),
  deviceHistory: (id: string) => unwrap<{ device: DeviceRecord; history: unknown[] }>(api.get(`/install/devices/${id}/history`)),

  execute: (id: string, actions: Array<{ type: string; params?: Record<string, unknown> }>) =>
    unwrap<{ results: Array<{ type: string; status: string; error?: string; evidence?: unknown }>; allOk: boolean }>(
      api.post(`/install/installations/${id}/execute`, { actions })
    ),
  diagnose: (id: string, check: string, assetId: string) =>
    unwrap<unknown>(api.post(`/install/installations/${id}/diagnostics`, { check, assetId })),
  generatePlan: (id: string) =>
    unwrap<{ plan: InstallationPlan; rejectedActions: string[]; notImplementedActions: string[] }>(
      api.post(`/install/installations/${id}/plan`)
    ),
  aiDiagnose: (id: string, diagnostics: Record<string, unknown>) =>
    unwrap<{ headline: string; severity: string; likelyCauses: string[]; recommendedSteps: Array<{ step: string; automatable: boolean }> }>(
      api.post(`/install/installations/${id}/ai-diagnose`, { diagnostics })
    ),
  recordHardwareTest: (body: Record<string, unknown>) => unwrap<unknown>(api.post('/install/lab/tests', body)),
};
