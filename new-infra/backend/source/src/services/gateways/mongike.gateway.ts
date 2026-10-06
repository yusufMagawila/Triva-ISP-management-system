import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { PaymentGateway, GatewayPaymentRequest, GatewayInitiateResponse, GatewayPaymentStatus } from './gateway.interface';

export class MongikeGateway implements PaymentGateway {
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

  async initiatePayment(req: GatewayPaymentRequest): Promise<GatewayInitiateResponse> {
    try {
      const response = await this.client.post<GatewayInitiateResponse>(
        '/api/v1/payments/mobile-money/tanzania',
        {
          order_id: req.orderId,
          amount: req.amount,
          buyer_phone: req.buyerPhone,
          fee_payer: 'MERCHANT',
          webhook_url: req.webhookUrl,
        }
      );
      logger.info('Mongike payment initiated', { orderId: req.orderId, status: 'success' });
      return response.data;
    } catch (err) {
      logger.error('Mongike payment initiation failed', { orderId: req.orderId, err });
      throw new Error('Payment initiation failed. Please try again.');
    }
  }

  async getTransactionStatus(orderId: string): Promise<GatewayPaymentStatus | null> {
    try {
      const response = await this.client.get<{ status: string; transaction_id?: string }>(
        `/api/v1/payments/${orderId}`
      );
      const raw = response.data;
      return { status: raw.status as GatewayPaymentStatus['status'], transaction_id: raw.transaction_id };
    } catch (err: any) {
      if (err?.response?.status === 404) {
        logger.warn('Mongike order not found (404)', { orderId });
        return { status: 'NOT_FOUND' };
      }
      logger.error('Mongike transaction status query failed', { orderId, err });
      return null;
    }
  }
}
