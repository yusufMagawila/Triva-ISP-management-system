import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { MongikePushRequest, MongikePushResponse, MongikeWebhookPayload } from '../types';
import { logger } from '../config/logger';

export class MongikeService {
  private client: AxiosInstance;

  constructor(apiKey?: string) {
    this.client = axios.create({
      baseURL: env.MONGIKE_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? env.MONGIKE_API_KEY,
      },
      timeout: 30_000,
    });
  }

  /**
   * Initiate a mobile money push payment via Mongike.
   * Docs: POST /api/v1/payments/mobile-money/tanzania
   */
  async initiatePayment(req: MongikePushRequest): Promise<MongikePushResponse> {
    try {
      const response = await this.client.post<MongikePushResponse>(
        '/api/v1/payments/mobile-money/tanzania',
        {
          order_id: req.orderId,
          amount: req.amount,
          buyer_phone: req.buyerPhone,
          fee_payer: 'MERCHANT',
          webhook_url: req.webhookUrl,
        }
      );

      logger.info('Mongike payment initiated', {
        orderId: req.orderId,
        responseBody: response.data,
      });

      return response.data;
    } catch (err) {
      logger.error('Mongike payment initiation failed', { orderId: req.orderId, err });
      throw new Error('Payment initiation failed. Please try again.');
    }
  }

  /**
   * Query Mongike for a transaction/order status.
   * Returns null on transient errors (retry later).
   * Returns { status: 'NOT_FOUND' } when Mongike returns 404 (order does not exist — mark FAILED).
   */
  async getTransactionStatus(orderId: string): Promise<MongikeWebhookPayload | null | { status: 'NOT_FOUND' }> {
    try {
      const response = await this.client.get<MongikeWebhookPayload>(
        `/api/v1/payments/${orderId}`
      );
      return response.data;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        logger.warn('Mongike order not found (404) — will mark as FAILED', { orderId });
        return { status: 'NOT_FOUND' };
      }
      logger.error('Mongike transaction status query failed', { orderId, err });
      return null;
    }
  }
}

export const mongikeService = new MongikeService();
