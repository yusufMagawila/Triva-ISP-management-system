import axios from 'axios';
import { logger } from '../../config/logger';
import { PaymentGateway, GatewayPaymentRequest, GatewayInitiateResponse, GatewayPaymentStatus } from './gateway.interface';

interface ZenoPayResponse {
  status?: string;
  resultcode?: string;
  message?: string;
  order_id?: string;
  checkout_request_id?: string;
  transaction_reference?: string;
  network?: string;
}

/**
 * ZenoPayMobile Gateway
 * Handles payment initiation with Tanzanian mobile money operators
 * Supports: M-Pesa, Airtel Money, Tigo Pesa, Halopesa
 */
export class ZenoPayMobileGateway implements PaymentGateway {
  private apiKey: string;
  private baseUrl = 'https://zenopaymobile.com';
  private timeout = 30_000; // 30 seconds

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('ZenoPayMobile API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Initiate a payment request
   * Sends payment request to ZenoPayMobile API
   */
  async initiatePayment(req: GatewayPaymentRequest): Promise<GatewayInitiateResponse> {
    let normalizedPhone = '';
    try {
      // Normalize phone number: ensure format 07XXXXXXXX or 255XXXXXXX
      normalizedPhone = this.normalizePhone(req.buyerPhone);

      const payload = {
        order_id: req.orderId,
        buyer_email: req.buyerEmail || 'customer@triva.app',
        buyer_name: req.buyerName || 'WiFi Customer',
        buyer_phone: normalizedPhone,
        amount: Math.round(Number(req.amount)), // Ensure integer amount
        webhook_url: req.webhookUrl,
        metadata: {
          reference: req.orderId,
        },
      };

      const response = await axios.post<ZenoPayResponse>(
        `${this.baseUrl}/api/payments/mobile_money_tanzania`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          timeout: this.timeout,
        }
      );

      const accepted = this.isInitiationAccepted(response.data);

      logger.info('ZenoPay initiation response received', {
        orderId: req.orderId,
        amount: payload.amount,
        buyerPhone: normalizedPhone,
        status: response.data.status,
        resultcode: response.data.resultcode,
        message: response.data.message,
        gatewayOrderId: response.data.order_id,
        checkoutRequestId: response.data.checkout_request_id,
        transactionReference: response.data.transaction_reference,
        network: response.data.network,
        accepted,
      });

      if (accepted) {
        return { order_id: response.data.order_id || req.orderId };
      }

      throw new Error(`ZenoPayMobile API error: ${response.data.message}`);
    } catch (error) {
      const message = this.extractErrorMessage(error);
      logger.error('ZenoPay initiation failed', {
        orderId: req.orderId,
        amount: req.amount,
        buyerPhone: normalizedPhone || req.buyerPhone,
        webhookUrl: req.webhookUrl,
        error: message,
      });
      throw new Error(`ZenoPayMobile payment initiation failed: ${message}`);
    }
  }

  /**
   * ZenoPay may return a push-accepted message even when resultcode is omitted
   * or status is not strictly "success". Treat accepted push messages as success.
   */
  private isInitiationAccepted(data: ZenoPayResponse): boolean {
    const status = (data.status || '').toUpperCase();
    const resultcode = (data.resultcode || '').toUpperCase();
    const message = (data.message || '').toLowerCase();

    const hasAcceptedPushMessage =
      message.includes('ussd push sent') ||
      message.includes('push sent') ||
      message.includes('enter your pin');

    return (
      status === 'SUCCESS' ||
      (status === 'SUCCESS' && (resultcode === '000' || resultcode === '0')) ||
      hasAcceptedPushMessage
    );
  }

  /**
   * Check transaction status
   * Note: ZenoPayMobile is webhook-only, so this returns PENDING
   * Actual status updates come via webhook callbacks
   */
  async getTransactionStatus(_orderId: string): Promise<GatewayPaymentStatus | null> {
    try {
      // ZenoPayMobile doesn't expose a direct status endpoint
      // Status updates come through webhooks only
      // Return PENDING to indicate we're waiting for webhook callback
      return { status: 'PENDING' };
    } catch (error) {
      const message = this.extractErrorMessage(error);
      logger.error('Failed to check ZenoPayMobile transaction status', { message });
      return null;
    }
  }

  /**
   * Normalize phone number to ZenoPayMobile format
   * Expected format: 07XXXXXXXX or 255XXXXXXX
   */
  private normalizePhone(phone: string): string {
    // Remove "+" and any separators so we always send digits only.
    let normalized = phone.trim().replace(/\D/g, '');

    // If starts with 0, replace with 255 (Tanzania country code)
    if (normalized.startsWith('0')) {
      normalized = '255' + normalized.substring(1);
    }

    // Validate Tanzania number (255 followed by 9 digits or 07-09 followed by 8 digits)
    if (!normalized.match(/^255\d{9}$/) && !normalized.match(/^0[789]\d{8}$/)) {
      throw new Error(`Invalid Tanzanian phone number format: ${phone}`);
    }

    return normalized;
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response?.data) {
        const data = error.response.data as { message?: string; error?: string };
        return data.message || data.error || JSON.stringify(data);
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
