/**
 * Installation readiness + bootstrap command.
 *
 * Read-only: answers "is this router ready to leave with the merchant?" from
 * data we already have (heartbeat, tenant, plans, branding, payments) plus a
 * live check that the public portal API serves this router.
 */

import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { buildRouterBootstrapUrls } from '../router-provisioning.service';

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Readiness {
  ready: boolean;
  routerId: string | null;
  checks: ReadinessCheck[];
}

/** A router counts as online if its heartbeat (every minute) was seen recently. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

async function findSiteRouter(tenantId: string, siteId: string) {
  return prisma.router.findFirst({
    where: { tenantId, siteId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getBootstrapCommand(tenantId: string, siteId: string) {
  const router = await findSiteRouter(tenantId, siteId);
  if (!router) return { routerId: null, commands: null as string | null };
  if (!router.provisioningKey) return { routerId: router.id, commands: null };
  const { bootstrapUrl } = buildRouterBootstrapUrls(
    { id: router.id, provisioningKey: router.provisioningKey } as never,
    env.APP_URL
  );
  const commands = [
    `/tool fetch mode=https url="${bootstrapUrl}" dst-path="triva-bootstrap.rsc" keep-result=yes check-certificate=no`,
    '/import file-name="triva-bootstrap.rsc"',
  ].join('\n');
  return { routerId: router.id, commands };
}

async function portalServesRouter(routerId: string): Promise<boolean> {
  try {
    const res = await fetch(`${env.APP_URL}/api/portal/router/${encodeURIComponent(routerId)}`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function computeReadiness(tenantId: string, siteId: string): Promise<Readiness> {
  const checks: ReadinessCheck[] = [];
  const add = (key: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ key, label, status, detail });

  const [router, tenant, planCount] = await Promise.all([
    findSiteRouter(tenantId, siteId),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        status: true,
        portalNoticeName: true,
        anypayEnabled: true,
        anypayApiKeyEnc: true,
        anypayApiKey: true,
        subscription: { select: { status: true, expiresAt: true } },
      },
    }),
    prisma.plan.count({ where: { tenantId, status: 'ACTIVE' } }),
  ]);

  if (!router) {
    add('router', 'Router registered', 'fail', 'No router is registered for this site yet. Scan the device first.');
  } else {
    add('router', 'Router registered', 'pass', router.name);
    const seenMs = router.lastSeenAt ? Date.now() - router.lastSeenAt.getTime() : Infinity;
    add(
      'online',
      'Router online',
      seenMs <= ONLINE_WINDOW_MS ? 'pass' : 'fail',
      seenMs <= ONLINE_WINDOW_MS
        ? 'Heartbeat received in the last 3 minutes.'
        : router.lastSeenAt
          ? 'No heartbeat for over 3 minutes. Check the internet cable, then re-run the setup command.'
          : 'The router has not contacted us yet. Run the setup command on the router.'
    );
    const wifiConfirmed = Boolean(router.wifiSsid && router.wifiSsid === router.wifiSsidApplied);
    add(
      'wifi',
      'WiFi name set on the router',
      wifiConfirmed ? 'pass' : 'warn',
      wifiConfirmed
        ? router.wifiSsid!
        : router.wifiSsid
          ? `"${router.wifiSsid}" is queued and applies on the router's next sync.`
          : 'Not set — the router keeps its factory WiFi name. Run the AI setup and give it a name.'
    );
  }

  const sub = tenant?.subscription;
  const tenantOk = tenant?.status === 'ACTIVE' && !(sub && (sub.status === 'EXPIRED' || new Date() > sub.expiresAt));
  add(
    'tenant',
    'Shop account active',
    tenantOk ? 'pass' : 'fail',
    tenantOk ? 'Account is active.' : 'The shop account is not active — the router will not serve customers until it is.'
  );

  add(
    'branding',
    'Shop name set',
    tenant?.portalNoticeName?.trim() ? 'pass' : 'fail',
    tenant?.portalNoticeName?.trim() ? tenant.portalNoticeName : 'Run the AI setup so the portal shows the shop name.'
  );

  add(
    'plans',
    'Packages created',
    planCount > 0 ? 'pass' : 'fail',
    planCount > 0 ? `${planCount} active package${planCount === 1 ? '' : 's'}.` : 'Add at least one package.'
  );

  const hasKey = Boolean(tenant?.anypayApiKeyEnc || tenant?.anypayApiKey);
  add(
    'payments',
    'Mobile money connected',
    hasKey && tenant?.anypayEnabled ? 'pass' : 'warn',
    hasKey && tenant?.anypayEnabled
      ? 'AnyPay is connected.'
      : 'Not connected yet. Vouchers still work; the merchant can add the AnyPay key later in Settings.'
  );

  if (router) {
    const ok = await portalServesRouter(router.id);
    add(
      'portal',
      'Portal serves this router',
      ok ? 'pass' : 'fail',
      ok ? 'The public portal returns this shop and its packages.' : 'The portal API did not return this router.'
    );
  }

  return {
    ready: checks.every((c) => c.status !== 'fail'),
    routerId: router?.id ?? null,
    checks,
  };
}
