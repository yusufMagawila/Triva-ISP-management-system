const mockPrisma: any = {
  user: { findUnique: jest.fn() }, tenant: { create: jest.fn(), findUnique: jest.fn() }, customer: { create: jest.fn() },
  site: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  installation: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  router: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  device: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
  plan: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  tpLinkRouter: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../config/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../services/audit.service', () => ({ recordAudit: jest.fn() }));
jest.mock('../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-fixture') }));

import { createMerchantInstallation, repeatInstallation, listInstallations, reuseInstallationRouter, moveResetDevice, onboardApply } from '../controllers/install.controller';
import { initiateActivationPayment } from '../controllers/auth.controller';
import { getPortalInfo, redeemPortalVoucher } from '../controllers/portal.controller';
import { identifyScannedDevice } from '../controllers/device.controller';
import { sessionService } from '../services/session.service';
import { resolveInstallationContext } from '../middleware/auth';
import { registerDevice } from '../services/devices/device.service';

const job = { id: 'job', tenantId: 'merchant', siteId: 'site', installerId: 'installer', status: 'DRAFT' };
function request(patch: any = {}): any {
  return { user: { userId: 'installer', tenantId: 'home', role: 'INSTALLER' }, body: {}, query: {}, params: {}, path: '/installations/job', method: 'GET', get: jest.fn(), ...patch };
}
function response(): any {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'installer', isActive: true, role: 'INSTALLER' });
  mockPrisma.installation.findUnique.mockResolvedValue(job);
  mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
});

it('creates a pending independent tenant, owner login, site and assigned job in one transaction', async () => {
  mockPrisma.tenant.create.mockResolvedValue({ id: 'merchant' });
  mockPrisma.customer.create.mockResolvedValue({ id: 'customer' });
  mockPrisma.site.create.mockResolvedValue({ id: 'site' });
  mockPrisma.installation.create.mockResolvedValue(job);
  const req = request({ body: { shopName: 'Cafe', merchantName: 'Owner', email: 'OWNER@example.test', password: 'private-fixture-password' } });
  const res = response();
  const next = jest.fn();
  await createMerchantInstallation(req, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  expect(mockPrisma.tenant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'PENDING', email: 'owner@example.test', users: { create: { name: 'Owner', email: 'owner@example.test', passwordHash: 'hashed-fixture', role: 'MERCHANT' } },
  }) });
  expect(mockPrisma.tenant.create.mock.calls[0][0].data.subscription).toBeUndefined();
  expect(mockPrisma.installation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'merchant', installerId: 'installer', siteId: 'site' }) });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-fixture-password');
});

it.each([{ password: 'short' }, { status: 'ACTIVE' }, { role: 'SUPER_ADMIN' }])('rejects invalid input and activation/role overrides: %j', async (patch) => {
  const next = jest.fn();
  await createMerchantInstallation(request({ body: { shopName: 'Cafe', merchantName: 'Owner', email: 'owner@example.test', password: 'private-fixture-password', ...patch } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

it('does not let a scoped job token create another merchant', async () => {
  const req = request(); req.user.scope = 'install';
  const next = jest.fn();
  await createMerchantInstallation(req, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
});

it('resolves a cross-tenant assigned job without changing the login token or granting dashboard privileges', async () => {
  const req = request(); const original = req.user;
  const next = jest.fn();
  await resolveInstallationContext(req, response(), next);
  expect(next).toHaveBeenCalledWith();
  expect(req.user).toMatchObject({ tenantId: 'merchant', role: 'INSTALLER', scope: 'install', installationId: 'job', siteId: 'site' });
  expect(original.tenantId).toBe('home');
});

it('denies another installer’s job', async () => {
  mockPrisma.installation.findUnique.mockResolvedValueOnce({ ...job, installerId: 'someone-else' });
  const res = response(); const next = jest.fn();
  await resolveInstallationContext(request(), res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

it('denies a disabled installer even with a valid login token', async () => {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ isActive: false, role: 'INSTALLER' });
  const res = response();
  await resolveInstallationContext(request(), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

it('rejects conflicting installation headers', async () => {
  const res = response();
  await resolveInstallationContext(request({ get: () => 'other-job' }), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

it('limits device lists to the assigned site', async () => {
  const req = request({ path: '/devices', get: () => 'job' });
  await resolveInstallationContext(req, response(), jest.fn());
  expect(req.query.siteId).toBe('site');
});

it('blocks device mutation outside the assigned site', async () => {
  const res = response();
  await resolveInstallationContext(request({ path: '/devices/register', method: 'POST', get: () => 'job', body: { siteId: 'other-site' } }), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(403);
});

it('lists only the installer’s assignments across merchant tenants', async () => {
  mockPrisma.installation.findMany.mockResolvedValue([]);
  await listInstallations(request(), response(), jest.fn());
  expect(mockPrisma.installation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { installerId: 'installer' } }));
});

it('reopens unfinished jobs instead of duplicating them', async () => {
  mockPrisma.site.findFirst.mockResolvedValue({ id: 'site', tenantId: 'merchant' });
  mockPrisma.installation.findFirst.mockResolvedValue(job);
  const res = response();
  await repeatInstallation(request({ body: { siteId: 'site' } }), res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ success: true, data: job });
  expect(mockPrisma.installation.create).not.toHaveBeenCalled();
});

it('rejects repeat installation on an unauthorized site', async () => {
  mockPrisma.site.findFirst.mockResolvedValueOnce(null);
  const next = jest.fn();
  await repeatInstallation(request({ body: { siteId: 'unknown' } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
});

it('requires confirmation before preparing a reset router', async () => {
  const next = jest.fn();
  await reuseInstallationRouter(request({ params: { id: 'job' }, user: { userId: 'installer', role: 'INSTALLER', tenantId: 'merchant' } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  expect(mockPrisma.router.update).not.toHaveBeenCalled();
});

it('rotates the setup key and clears stale acknowledgements without deleting ownership or payments', async () => {
  mockPrisma.router.findFirst.mockResolvedValue({ id: 'router' });
  const next = jest.fn();
  await reuseInstallationRouter(request({ params: { id: 'job' }, user: { userId: 'installer', role: 'INSTALLER', tenantId: 'merchant' }, body: { confirmReset: true } }), response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(mockPrisma.router.update).toHaveBeenCalledWith({ where: { id: 'router' }, data: expect.objectContaining({ status: 'OFFLINE', wifiSsidApplied: null, lastSeenAt: null, provisioningKey: expect.stringMatching(/^trk_/) }) });
  expect(mockPrisma.router.update.mock.calls[0][0].data.tenantId).toBeUndefined();
});

it('links a scanned device to its existing same-site router instead of duplicating the router', async () => {
  mockPrisma.device.findFirst.mockResolvedValue(null);
  mockPrisma.site.findUnique.mockResolvedValue({ tenantId: 'merchant' });
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'router', tenantId: 'merchant', siteId: 'site', hardwareMac: 'aa:bb:cc:dd:ee:ff', serialNumber: null }]);
  mockPrisma.device.create.mockResolvedValue({ id: 'device', siteId: 'site' });
  await registerDevice('merchant', 'installer', { vendor: 'MIKROTIK', deviceType: 'ROUTER', macAddress: 'AA:BB:CC:DD:EE:FF', siteId: 'site' });
  expect(mockPrisma.device.create).toHaveBeenCalledWith({ data: expect.objectContaining({ routerId: 'router', tenantId: 'merchant' }) });
});

it('does not silently keep old package settings after the installer confirms different prices', async () => {
  mockPrisma.plan.findMany.mockResolvedValue([{ name: 'Hourly', price: 500, durationMins: 60, status: 'ACTIVE', downloadKbps: null, uploadKbps: null, dataLimitMb: null }]);
  const next = jest.fn();
  await onboardApply(request({ params: { id: 'job' }, user: { userId: 'installer', tenantId: 'merchant', role: 'INSTALLER' }, body: { profile: { shopName: 'Cafe', plans: [{ name: 'Hourly', price: 1000, durationMins: 60 }] } } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({ where: { tenantId: 'merchant' } });
  expect(mockPrisma.router.update).not.toHaveBeenCalled();
});

it('keeps installer-created merchant activation admin-controlled', async () => {
  mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'merchant', status: 'PENDING' });
  mockPrisma.installation.findFirst.mockResolvedValue({ id: 'job' });
  const res = response(); const next = jest.fn();
  await initiateActivationPayment(request({ user: { tenantId: 'merchant' }, body: { phone: 'fixture' } }), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
});

it('requires an admin to transfer a reset router', async () => {
  const next = jest.fn();
  await moveResetDevice(request({ params: { id: 'job' }, body: { deviceId: 'device', confirmReset: true } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

it('archives old provisioning access on an admin-confirmed move and preserves the old router/payment history', async () => {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'admin', isActive: true, role: 'SUPER_ADMIN' });
  mockPrisma.device.findUnique.mockResolvedValue({ id: 'device', vendor: 'MIKROTIK', tenantId: 'old-merchant', siteId: 'old-site', routerId: 'old-router', serialNumber: null, macAddress: 'aa:bb:cc:dd:ee:ff' });
  mockPrisma.router.findFirst.mockResolvedValue(null);
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'old-router', tenantId: 'old-merchant', lastSeenAt: new Date(0) }]);
  mockPrisma.device.update.mockResolvedValue({ id: 'device', tenantId: 'merchant', siteId: 'site' });
  const next = jest.fn();
  await moveResetDevice(request({ params: { id: 'job' }, user: { userId: 'admin', role: 'SUPER_ADMIN' }, body: { deviceId: 'device', confirmReset: true } }), response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(mockPrisma.router.update).toHaveBeenCalledWith({ where: { id: 'old-router' }, data: expect.objectContaining({ provisioningKey: null, hardwareMac: null, serialNumber: null, siteId: null }) });
  expect(mockPrisma.router.update.mock.calls[0][0].data.tenantId).toBeUndefined();
  expect(mockPrisma.device.update).toHaveBeenCalledWith({ where: { id: 'device' }, data: expect.objectContaining({ tenantId: 'merchant', siteId: 'site', routerId: null }) });
  expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'old-merchant', action: 'RESET_ROUTER_RELEASED' }) });
});

it('refuses to transfer a router that is still checking in', async () => {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'admin', isActive: true, role: 'SUPER_ADMIN' });
  mockPrisma.device.findUnique.mockResolvedValue({ id: 'device', vendor: 'MIKROTIK', tenantId: 'old-merchant', siteId: 'old-site', routerId: 'old-router' });
  mockPrisma.router.findFirst.mockResolvedValue(null);
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'old-router', tenantId: 'old-merchant', lastSeenAt: new Date() }]);
  const next = jest.fn();
  await moveResetDevice(request({ params: { id: 'job' }, user: { userId: 'admin', role: 'SUPER_ADMIN' }, body: { deviceId: 'device', confirmReset: true } }), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  expect(mockPrisma.router.update).not.toHaveBeenCalled();
});

it('identifies operational-only router registrations for admin reuse without creating inventory during a scan', async () => {
  mockPrisma.device.findFirst.mockResolvedValue(null);
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'legacy', name: 'Old lab router', tenantId: 'old', siteId: 'old-site' }]);
  const res = response();
  await identifyScannedDevice(request({ user: { role: 'SUPER_ADMIN', userId: 'admin' }, query: { tenantId: 'merchant', siteId: 'site' }, body: { payload: 'AA:BB:CC:DD:EE:FF' } }), res, jest.fn());
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: 'LEGACY_ROUTER', legacyRouter: expect.objectContaining({ id: 'legacy' }) }) }));
  expect(mockPrisma.device.create).not.toHaveBeenCalled();
});

it('does not expose another merchant’s operational-only router details to an installer', async () => {
  mockPrisma.device.findFirst.mockResolvedValue(null);
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'legacy', name: 'Private merchant', tenantId: 'old', siteId: 'old-site' }]);
  const res = response();
  await identifyScannedDevice(request({ body: { payload: 'AA:BB:CC:DD:EE:FF' } }), res, jest.fn());
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: 'UNAVAILABLE', legacyRouter: null, device: null }) }));
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('Private merchant');
});

it('moves an operational-only registration through the same confirmed admin flow', async () => {
  mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'admin', isActive: true, role: 'SUPER_ADMIN' });
  mockPrisma.device.findUnique.mockResolvedValue(null);
  mockPrisma.router.findUnique.mockResolvedValueOnce({ id: 'legacy', tenantId: 'old', siteId: 'old-site', hardwareMac: 'aa:bb:cc:dd:ee:ff', serialNumber: null });
  mockPrisma.device.create.mockResolvedValueOnce({ id: 'inventory', vendor: 'MIKROTIK', tenantId: 'old', siteId: 'old-site', routerId: 'legacy', macAddress: 'aa:bb:cc:dd:ee:ff' });
  mockPrisma.router.findFirst.mockResolvedValue(null);
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'legacy', tenantId: 'old', lastSeenAt: new Date(0) }]);
  mockPrisma.device.update.mockResolvedValue({ id: 'inventory', tenantId: 'merchant', siteId: 'site' });
  const next = jest.fn();
  await moveResetDevice(request({ params: { id: 'job' }, user: { role: 'SUPER_ADMIN', userId: 'admin' }, body: { routerId: 'legacy', confirmReset: true } }), response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(mockPrisma.router.update).toHaveBeenCalledWith({ where: { id: 'legacy' }, data: expect.objectContaining({ retiredAt: expect.any(Date), provisioningKey: null }) });
});

it('does not serve packages from a retired router portal link', async () => {
  mockPrisma.router.findUnique.mockResolvedValueOnce({ id: 'retired', retiredAt: new Date(), tenant: { status: 'ACTIVE' } });
  const res = response(); const next = jest.fn();
  await getPortalInfo(request({ params: { routerId: 'retired' } }), res, next);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(mockPrisma.plan.findMany).not.toHaveBeenCalled();
});

it('does not redeem a voucher on a retired router', async () => {
  mockPrisma.router.findUnique.mockResolvedValueOnce({ id: 'retired', retiredAt: new Date(), tenantId: 'old' });
  const res = response();
  await redeemPortalVoucher(request({ body: { routerId: 'retired', macAddress: 'aa:bb:cc:dd:ee:ff', code: 'fixture' } }), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
});

it('does not create a new paid session for a retired router', async () => {
  mockPrisma.plan.findUniqueOrThrow.mockResolvedValue({ id: 'plan', tenantId: 'old' });
  mockPrisma.router.findUnique.mockResolvedValueOnce({ id: 'retired', retiredAt: new Date(), tenantId: 'old' });
  await expect(sessionService.createPendingSession('old', 'retired', 'plan', 'aa:bb:cc:dd:ee:ff')).rejects.toThrow('Router not found');
});

it('does not steal an existing router from another merchant', async () => {
  mockPrisma.device.findFirst.mockResolvedValue(null);
  mockPrisma.site.findUnique.mockResolvedValue({ tenantId: 'merchant' });
  mockPrisma.router.findMany.mockResolvedValue([{ id: 'router', tenantId: 'other', siteId: 'elsewhere', serialNumber: null, hardwareMac: 'aa:bb:cc:dd:ee:ff' }]);
  await expect(registerDevice('merchant', 'installer', { vendor: 'MIKROTIK', deviceType: 'ROUTER', macAddress: 'AA:BB:CC:DD:EE:FF', siteId: 'site' })).rejects.toMatchObject({ statusCode: 409 });
  expect(mockPrisma.device.create).not.toHaveBeenCalled();
});
