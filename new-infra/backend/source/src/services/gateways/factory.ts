import { PaymentGateway } from './gateway.interface';
import { decryptTenantKey } from '../../lib/crypto';
import { MongikeGateway } from './mongike.gateway';
import { AnypayGateway } from './anypay.gateway';
import { ZenoPayMobileGateway } from './zenopay-mobile.gateway';

interface TenantGatewayConfig {
  paymentProvider: string;
  mongikApiKeyEnc?: string | null;
  mongikApiKey?: string | null;    // legacy plaintext, remove after migration
  anypayApiKeyEnc?: string | null;
  anypayApiKey?: string | null;    // legacy plaintext, remove after migration
  zenopayApiKeyEnc?: string | null;
  zenopayApiKey?: string | null;   // legacy plaintext, remove after migration
}

function resolveKey(enc?: string | null, plain?: string | null): string {
  if (enc) return decryptTenantKey(enc);
  if (plain) return plain;
  throw new Error('Payment key not configured');
}

export function createGateway(tenant: TenantGatewayConfig): PaymentGateway {
  if (tenant.paymentProvider === 'ANYPAY') {
    const key = resolveKey(tenant.anypayApiKeyEnc, tenant.anypayApiKey);
    return new AnypayGateway(key);
  }

  if (tenant.paymentProvider === 'ZENOPAY_MOBILE') {
    const key = resolveKey(tenant.zenopayApiKeyEnc, tenant.zenopayApiKey);
    return new ZenoPayMobileGateway(key);
  }

  const key = tenant.mongikApiKeyEnc
    ? decryptTenantKey(tenant.mongikApiKeyEnc)
    : (tenant.mongikApiKey ?? undefined);
  return new MongikeGateway(key);
}
