import type {
  PortalInfo,
  SessionStatus,
  InitiateResponse,
} from './types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

export class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new RequestError(0, 'network');
  }
  let body: { success?: boolean; error?: string; data?: T } | null = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok || body?.success === false) {
    throw new RequestError(res.status, body?.error ?? 'Request failed');
  }
  return (body?.data ?? body) as T;
}

export function getRouterPortalInfo(routerId: string, mac?: string): Promise<PortalInfo> {
  const q = mac ? `?mac=${encodeURIComponent(mac)}` : '';
  return request(`/api/portal/router/${encodeURIComponent(routerId)}${q}`);
}

export function getOmadaPortalInfo(siteId: string, tenantId: string | undefined, mac?: string): Promise<PortalInfo> {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  if (tenantId) params.set('tenantId', tenantId);
  if (mac) params.set('mac', mac);
  return request(`/api/omada/portal-info?${params}`);
}

export function initiateRouterPayment(body: {
  tenantId: string;
  routerId: string;
  planId: string;
  macAddress: string;
  ipAddress?: string;
  phone: string;
}): Promise<InitiateResponse> {
  return request('/api/payments/portal/initiate', { method: 'POST', body: JSON.stringify(body) });
}

export function initiateOmadaPayment(body: {
  tenantId?: string;
  siteId?: string;
  planId: string;
  macAddress: string;
  ipAddress?: string;
  phone: string;
}): Promise<InitiateResponse> {
  return request('/api/omada/initiate-payment', { method: 'POST', body: JSON.stringify(body) });
}

export function getSessionStatus(sessionId: string): Promise<SessionStatus> {
  return request(`/api/portal/session/${encodeURIComponent(sessionId)}`);
}

export function redeemRouterVoucher(body: {
  routerId: string;
  macAddress: string;
  ipAddress?: string;
  code: string;
}): Promise<{ sessionId: string; expiresAt: string | null; plan?: { name: string; durationMins: number } }> {
  return request('/api/portal/redeem-voucher', { method: 'POST', body: JSON.stringify(body) });
}

export function redeemOmadaVoucher(body: {
  tenantId?: string;
  siteId?: string;
  macAddress: string;
  ipAddress?: string;
  code: string;
}): Promise<{ sessionId: string; expiresAt: string; omadaToken: string; alreadyActive?: boolean }> {
  return request('/api/omada/redeem-voucher', { method: 'POST', body: JSON.stringify(body) });
}

export function getOmadaRedirect(sessionId: string): Promise<{ sessionId: string; omadaToken: string }> {
  return request(`/api/omada/redirect/${encodeURIComponent(sessionId)}`);
}
