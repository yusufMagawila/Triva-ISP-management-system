import { AnypayGateway } from './anypay.gateway';
import { decryptTenantKey } from '../../lib/crypto';

interface TenantGatewayConfig {
  anypayApiKeyEnc?: string | null;
  anypayApiKey?: string | null;    // legacy plaintext, remove after migration
  anypayBaseUrl?: string | null;
}

export function resolveTenantAnypayBundle(tenant: TenantGatewayConfig): string {
  if (tenant.anypayApiKeyEnc) return decryptTenantKey(tenant.anypayApiKeyEnc);
  if (tenant.anypayApiKey) return tenant.anypayApiKey;
  throw new Error('AnyPay is not configured for this tenant');
}

/**
 * AnyPay is the only supported payment provider. Creates a gateway bound to the
 * tenant's own AnyPay credentials so WiFi payments settle to the tenant's
 * AnyPay account.
 */
export function createGateway(tenant: TenantGatewayConfig): AnypayGateway {
  return new AnypayGateway(resolveTenantAnypayBundle(tenant), tenant.anypayBaseUrl);
}
