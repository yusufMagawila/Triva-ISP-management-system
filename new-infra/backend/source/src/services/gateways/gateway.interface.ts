export interface GatewayPaymentRequest {
  orderId: string;
  amount: number;
  buyerPhone: string;
  webhookUrl: string;
  buyerEmail?: string;
  buyerName?: string;
}

export interface GatewayInitiateResponse {
  order_id?: string;
}

export interface GatewayPaymentStatus {
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING' | 'NOT_FOUND';
  transaction_id?: string;
}

export interface PaymentGateway {
  initiatePayment(req: GatewayPaymentRequest): Promise<GatewayInitiateResponse>;
  getTransactionStatus(orderId: string): Promise<GatewayPaymentStatus | null>;
}
