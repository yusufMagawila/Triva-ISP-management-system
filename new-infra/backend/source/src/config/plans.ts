/**
 * Subscription plan definitions — single source of truth.
 * Any enforcement logic (router limits, session limits) reads from here.
 */
export type PlanName = 'BASIC' | 'STANDARD' | 'PREMIUM';

export interface PlanConfig {
  priceTZS: number;        // Monthly price in TZS
  maxRouters: number;       // Max MikroTik routers allowed (-1 = unlimited)
  maxSessionsPerDay: number; // Max WiFi sessions per day across all routers (-1 = unlimited)
  label: string;
}

export const PLANS: Record<PlanName, PlanConfig> = {
  BASIC: {
    priceTZS: 15_000,
    maxRouters: 2,
    maxSessionsPerDay: 200,
    label: 'Basic',
  },
  STANDARD: {
    priceTZS: 30_000,
    maxRouters: 10,
    maxSessionsPerDay: -1, // unlimited
    label: 'Standard',
  },
  PREMIUM: {
    priceTZS: 60_000,
    maxRouters: -1,        // unlimited
    maxSessionsPerDay: -1, // unlimited
    label: 'Premium',
  },
};

/** Returns the plan config for a tenant's current subscription, defaulting to BASIC. */
export function getPlanConfig(plan: string | null | undefined): PlanConfig {
  return PLANS[(plan as PlanName) ?? 'BASIC'] ?? PLANS.BASIC;
}
