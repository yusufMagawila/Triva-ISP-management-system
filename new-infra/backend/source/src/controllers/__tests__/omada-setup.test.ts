const mockPrisma: any = { omadaSite: { findFirst: jest.fn(), update: jest.fn() } };
jest.mock('../../config/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../../config/env', () => ({ env: {
  PORTAL_URL: 'https://portal.example.com',
  OMADA_CONTROLLER_URL: 'https://controller.example.com',
  RADIUS_PUBLIC_HOST: '192.0.2.1',
} }));
jest.mock('../../lib/crypto', () => ({ decryptRouterCredential: () => 'test-secret' }));
jest.mock('../../services/device-registry.service', () => ({}));
jest.mock('../../services/audit.service', () => ({ recordAudit: jest.fn() }));

import { getOmadaSetup, markOmadaSiteProvisioned } from '../omada-site.controller';

function response() {
  const res: any = { setHeader: jest.fn(), json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

it('scopes setup secrets to the authenticated tenant and disables caching', async () => {
  mockPrisma.omadaSite.findFirst.mockResolvedValue({ id: 'site-1', controllerIp: '192.0.2.10', radiusSecretEnc: 'encrypted' });
  const res = response();
  await getOmadaSetup({ params: { id: 'site-1' }, user: { role: 'MERCHANT', tenantId: 'tenant-1' } } as any, res, jest.fn());
  expect(mockPrisma.omadaSite.findFirst).toHaveBeenCalledWith({ where: { id: 'site-1', tenantId: 'tenant-1' } });
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({
    radiusSecret: 'test-secret', radiusHost: '192.0.2.1',
    portalUrl: 'https://portal.example.com/captive-portal-omada/?siteId=site-1',
  }) });
});

it('does not expose secrets from another tenant', async () => {
  mockPrisma.omadaSite.findFirst.mockResolvedValue(null);
  const res = response();
  await getOmadaSetup({ params: { id: 'foreign-site' }, user: { role: 'MERCHANT', tenantId: 'tenant-1' } } as any, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
});

it('blocks setup without an exact RADIUS source', async () => {
  mockPrisma.omadaSite.findFirst.mockResolvedValue({ id: 'site-1', controllerIp: '' });
  const res = response();
  await getOmadaSetup({ params: { id: 'site-1' }, user: { role: 'MERCHANT', tenantId: 'tenant-1' } } as any, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(409);
});

it('does not label a site online merely because configuration was acknowledged', async () => {
  mockPrisma.omadaSite.findFirst.mockResolvedValue({ id: 'site-1' });
  mockPrisma.omadaSite.update.mockResolvedValue({ id: 'site-1' });
  await markOmadaSiteProvisioned({ params: { id: 'site-1' }, user: { role: 'MERCHANT', tenantId: 'tenant-1' } } as any, response(), jest.fn());
  expect(mockPrisma.omadaSite.update).toHaveBeenCalledWith({ where: { id: 'site-1' }, data: { provisionedAt: expect.any(Date) } });
});
