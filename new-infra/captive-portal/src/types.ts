export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number | string; // Prisma Decimal serializes as string
  durationMins: number;
  downloadKbps: number | null;
  uploadKbps: number | null;
  dataLimitMb: number | null;
}

export interface TenantBranding {
  id: string;
  name: string;
  logoUrl: string | null;
  portalNoticeName: string | null;
  portalNoticeMessage: string | null;
  portalNoticeColor: string | null;
}

export interface ActiveSession {
  id: string;
  expiresAt: string;
  plan: Plan | null;
}

export interface PortalInfo {
  router?: { id: string; name: string };
  tenant: TenantBranding;
  plans: Plan[];
  activeSession: ActiveSession | null;
}

export interface SessionStatus {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED';
  vendor: string;
  macAddress: string;
  expiresAt: string | null;
  plan: { name: string; durationMins: number } | null;
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | null;
  credentials: { username: string; password: string } | null;
  /** Short-lived socket token bound to this tenant+MAC (needed for realtime). */
  socketToken?: string;
}

export interface InitiateResponse {
  sessionId: string;
  paymentId: string;
  transactionId: string;
  amount: number;
  alreadyActive?: boolean;
  expiresAt?: string;
  message?: string;
}

export interface ApiError {
  status: number;
  message: string;
}
