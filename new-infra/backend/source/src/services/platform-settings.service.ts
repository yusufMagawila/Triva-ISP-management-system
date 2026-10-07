import { prisma } from '../config/prisma';
import { decryptTenantKey, encryptTenantKey } from '../lib/crypto';
import {
  AnypayGateway,
  ANYPAY_DEFAULT_BASE_URL,
  parseAnypayCredentialBundle,
} from './gateways/anypay.gateway';

const PLATFORM_SETTINGS_ID = 1;

export interface PlatformPaymentConfig {
  apiKey: string;
  accessToken: string;
  baseUrl: string;
  enabled: boolean;
}

/**
 * Load the platform's own AnyPay configuration. These credentials collect
 * platform revenue (tenant activation + subscription payments) and are managed
 * by SUPER_ADMINs through the admin panel — never per-tenant settings.
 */
export async function getPlatformPaymentConfig(): Promise<PlatformPaymentConfig> {
  const row = await prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTINGS_ID } });

  const bundle = row?.anypayKeyEnc ? decryptTenantKey(row.anypayKeyEnc) : '';
  const { apiKey, accessToken } = parseAnypayCredentialBundle(bundle);

  return {
    apiKey,
    accessToken,
    baseUrl: row?.anypayBaseUrl ?? '',
    enabled: row?.anypayEnabled ?? false,
  };
}

/**
 * Returns a configured platform AnyPay gateway, or null when platform payments
 * are disabled / not configured. Callers must handle the null case with a
 * user-facing error rather than throwing.
 */
export async function getPlatformGateway(): Promise<AnypayGateway | null> {
  const config = await getPlatformPaymentConfig();
  if (!config.enabled || !config.apiKey) return null;
  return new AnypayGateway(
    config.accessToken && config.accessToken !== config.apiKey
      ? `${config.accessToken}::${config.apiKey}`
      : config.apiKey,
    config.baseUrl || ANYPAY_DEFAULT_BASE_URL
  );
}

/**
 * Persist the platform AnyPay configuration. Secret fields are only updated
 * when a non-empty value is supplied, so the admin UI can save non-secret
 * fields without re-sending credentials.
 */
export async function updatePlatformPaymentConfig(input: {
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
  enabled?: boolean;
}): Promise<void> {
  const data: Record<string, unknown> = {};

  if (input.apiKey !== undefined || input.accessToken !== undefined) {
    const existing = await getPlatformPaymentConfig();
    const apiKey = input.apiKey !== undefined ? input.apiKey.trim() : existing.apiKey;
    const accessToken =
      input.accessToken !== undefined ? input.accessToken.trim() : existing.accessToken;

    if (!apiKey && !accessToken) {
      data.anypayKeyEnc = null;
    } else {
      const bundle =
        !apiKey || !accessToken || apiKey === accessToken
          ? apiKey || accessToken
          : `${accessToken}::${apiKey}`;
      data.anypayKeyEnc = encryptTenantKey(bundle);
    }
  }

  if (input.baseUrl !== undefined) {
    const trimmed = input.baseUrl.trim();
    data.anypayBaseUrl = trimmed || null;
  }

  if (input.enabled !== undefined) {
    data.anypayEnabled = input.enabled;
  }

  await prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: data,
    create: { id: PLATFORM_SETTINGS_ID, ...data },
  });
}

/** Masked, credential-free view suitable for API responses. */
export async function getPlatformPaymentConfigView(): Promise<{
  enabled: boolean;
  configured: boolean;
  apiKeyMasked: string | null;
  accessTokenMasked: string | null;
  baseUrl: string;
}> {
  const config = await getPlatformPaymentConfig();
  const mask = (v: string) => (v ? `••••••••${v.slice(-4)}` : null);
  return {
    enabled: config.enabled,
    configured: !!config.apiKey,
    apiKeyMasked: mask(config.apiKey),
    accessTokenMasked: mask(config.accessToken),
    baseUrl: config.baseUrl || ANYPAY_DEFAULT_BASE_URL,
  };
}
