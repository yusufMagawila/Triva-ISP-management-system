import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

// ─── Extended Request Types ───────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  tenantId: string | null;
  role: UserRole;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export interface TenantRequest extends AuthRequest {
  tenantId: string;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  pagination?: Pagination;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── MikroTik ─────────────────────────────────────────────────────────────────

export interface MikroTikConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

// ─── TP-Link (OpenWrt) ────────────────────────────────────────────────────────

export interface TpLinkConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface HotspotUser {
  name: string;
  password: string;
  profile?: string;
  macAddress?: string;
  limitUptime?: string;  // e.g. "01:00:00"
  limitBytesTotal?: string;
  comment?: string;
}

export interface HotspotActive {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: string;
  bytesOut: string;
}

export interface RouterOSResponse {
  '.id'?: string;
  [key: string]: string | undefined;
}

// ─── Mongike ──────────────────────────────────────────────────────────────────

export interface MongikePushRequest {
  orderId: string;       // Our payment record ID
  amount: number;
  buyerPhone: string;    // Format: 255XXXXXXXXX
  webhookUrl: string;
}

export interface MongikePushResponse {
  success: boolean;
  status: string;
  order_id?: string;
  message?: string;
}

export interface MongikeWebhookPayload {
  order_id: string;      // Matches our payment ID
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  amount: number;
  buyer_phone: string;
  transaction_id?: string;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

export interface SocketEvents {
  // Server → Client
  'session:activated': { sessionId: string; expiresAt: string };
  'session:expired': { sessionId: string; macAddress: string };
  'session:stats': { sessionId: string; bytesIn: number; bytesOut: number };
  'payment:completed': { paymentId: string; sessionId: string };
  'payment:failed': { paymentId: string; reason: string };
  'router:status': { routerId: string; status: string };
  // Client → Server
  'portal:subscribe': { macAddress: string; tenantId: string };
  'portal:unsubscribe': { macAddress: string };
  'dashboard:subscribe': { tenantId: string };
}

export type Handler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
