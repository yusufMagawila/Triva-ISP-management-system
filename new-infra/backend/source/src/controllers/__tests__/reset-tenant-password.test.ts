import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const prismaMock = {
  tenant: { findUnique: jest.fn() },
  user: { findFirst: jest.fn(), update: jest.fn() },
};
const auditMock = jest.fn();

jest.mock('../../config/prisma', () => ({ prisma: prismaMock }));
jest.mock('../../services/audit.service', () => ({ recordAudit: auditMock }));
jest.mock('../../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/subscription.service', () => ({ subscriptionService: {} }));
jest.mock('../../services/platform-settings.service', () => ({
  getPlatformPaymentConfigView: jest.fn(), updatePlatformPaymentConfig: jest.fn(), getPlatformGateway: jest.fn(),
}));

import { resetTenantPassword } from '../admin.controller';

function run(body: unknown, id = 'ten-1') {
  const res: { status: jest.Mock; json: jest.Mock } = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const next = jest.fn();
  return resetTenantPassword({ params: { id }, body, user: { userId: 'admin-1' } } as never, res as never, next).then(() => ({ res, next }));
}

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.tenant.findUnique.mockResolvedValue({ id: 'ten-1', name: 'Shop' } as never);
  prismaMock.user.findFirst.mockResolvedValue({ id: 'usr-1', email: 'm@shop.com' } as never);
  prismaMock.user.update.mockResolvedValue({} as never);
});

describe('resetTenantPassword', () => {
  it('rejects short passwords without touching the database', async () => {
    const { res } = await run({ newPassword: 'short' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown tenant', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null as never);
    const { res } = await run({ newPassword: 'long-enough-pass' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('404s when the requested user is not inside that tenant', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null as never);
    const { res } = await run({ newPassword: 'long-enough-pass', userId: 'someone-else' });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'someone-else', tenantId: 'ten-1' } }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('stores a bcrypt hash, audits without the password, and never returns it', async () => {
    const { res } = await run({ newPassword: 'long-enough-pass' });
    const data = (prismaMock.user.update.mock.calls[0][0] as { data: { passwordHash: string } }).data;
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(data.passwordHash).not.toContain('long-enough-pass');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'TENANT_PASSWORD_RESET', targetId: 'usr-1' }));
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain('long-enough-pass');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('long-enough-pass');
  });
});
