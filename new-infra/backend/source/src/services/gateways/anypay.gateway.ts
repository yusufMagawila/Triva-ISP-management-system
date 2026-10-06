import axios, { AxiosInstance, AxiosRequestHeaders } from 'axios';
import { logger } from '../../config/logger';
import { PaymentGateway, GatewayPaymentRequest, GatewayInitiateResponse, GatewayPaymentStatus } from './gateway.interface';

const ANYPAY_BASE_URL = 'https://anypaytanzania.com/api/payments';

export interface AnypayCredentials {
  accessToken: string;
  apiKey: string;
}

function withBearerPrefix(token: string): string {
  const raw = token.trim();
  if (!raw) return '';
  return /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

/**
 * AnyPay credentials may be stored in three formats:
 *   1. JSON:            {"accessToken":"...","apiKey":"..."}
 *   2. Bundle:          accessToken::apiKey
 *   3. Legacy single:   apiKey        (no access token — API-Key header only)
 *
 * Sending an `Authorization: Bearer <apiKey>` header when no real access token
 * exists makes AnyPay reject the whole request with 403 "token_not_valid",
 * so the Authorization header must only be set when a genuine token is present.
 */
export function parseAnypayCredentialBundle(value?: string | null): AnypayCredentials {
  const raw = (value ?? '').trim();
  if (!raw) return { accessToken: '', apiKey: '' };

  // Optional JSON format for future-proofing.
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { accessToken?: string; apiKey?: string };
      const accessToken = (parsed.accessToken ?? '').trim();
      const apiKey = (parsed.apiKey ?? '').trim();
      if (accessToken || apiKey) {
        return { accessToken, apiKey: apiKey || accessToken };
      }
    } catch {
      // Fall through to legacy/string parsing.
    }
  }

  // Preferred bundle format: accessToken::apiKey
  const separatorIndex = raw.indexOf('::');
  if (separatorIndex >= 0) {
    const accessToken = raw.slice(0, separatorIndex).trim();
    const apiKey = raw.slice(separatorIndex + 2).trim();
    return { accessToken, apiKey: apiKey || accessToken };
  }

  // Backward-compatible fallback: legacy single value means API key only.
  return { accessToken: '', apiKey: raw };
}

export class AnypayGateway implements PaymentGateway {
  private client: AxiosInstance;

  constructor(credentialBundle: string) {
    const { accessToken, apiKey } = parseAnypayCredentialBundle(credentialBundle);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'API-Key': apiKey,
    };

    // Only send Authorization when a real access token is configured.
    if (accessToken) {
      headers.Authorization = withBearerPrefix(accessToken);
    }

    this.client = axios.create({
      baseURL: ANYPAY_BASE_URL,
      headers: headers as unknown as AxiosRequestHeaders,
      timeout: 30_000,
    });
  }

  async initiatePayment(req: GatewayPaymentRequest): Promise<GatewayInitiateResponse> {
    try {
      const response = await this.client.post('/wallet/pull/', {
        order_id: req.orderId,
        phone: req.buyerPhone,
        amount: req.amount,
      });
      logger.info('AnyPay payment initiated', { orderId: req.orderId, status: 'success' });
      return { order_id: response.data?.order_id ?? req.orderId };
    } catch (err) {
      logger.error('AnyPay payment initiation failed', { orderId: req.orderId, err });
      throw new Error('Payment initiation failed. Please try again.');
    }
  }

  async getTransactionStatus(orderId: string): Promise<GatewayPaymentStatus | null> {
    try {
      const response = await this.client.get(`/check-order-status/?order_id=${orderId}`);
      const data = response.data?.data;
      if (!data) return null;

      const raw = (data.selcom_payment_status as string)?.toUpperCase();
      if (raw === 'COMPLETED') return { status: 'SUCCESS', transaction_id: data.selcom_transid };
      if (raw === 'FAILED') return { status: 'FAILED' };
      if (raw === 'CANCELLED') return { status: 'CANCELLED' };
      if (raw === 'PENDING' || raw === 'PROCESSING') return { status: 'PENDING' };
      return null;
    } catch (err: any) {
      if (err?.response?.status === 404 || isAnypayOrderNotFound(err)) {
        logger.warn('AnyPay order not found', { orderId });
        return { status: 'NOT_FOUND' };
      }
      logger.error('AnyPay transaction status query failed', { orderId, err });
      return null;
    }
  }
}

/**
 * AnyPay reports an unknown order as HTTP 400 wrapping a Selcom resultcode of
 * 404, not as a bare HTTP 404. Without this the reconciliation job can never
 * mark such orders NOT_FOUND and re-logs the same error on every cycle.
 */
function isAnypayOrderNotFound(err: any): boolean {
  const data = err?.response?.data;
  if (!data || err?.response?.status !== 400) return false;

  const selcom = data.selcom_response;
  if (selcom) {
    if (String(selcom.resultcode ?? '') === '404') return true;
    if (/not\s*found/i.test(String(selcom.message ?? ''))) return true;
  }
  return /not\s*found/i.test(String(data.message ?? ''));
}
