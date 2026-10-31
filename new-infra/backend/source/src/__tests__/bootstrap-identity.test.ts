const mockPrisma: any = { router: { findFirst: jest.fn(), update: jest.fn() } };
jest.mock('../config/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../services/session.service', () => ({ sessionService: {} }));

import { Prisma } from '@prisma/client';
import { heartbeatBootstrapRouter } from '../controllers/bootstrap.controller';

const router = { id: 'pilot', serialNumber: null, hardwareMac: null, provisionedAt: null };
const request = { params: { provisioningKey: 'fixture-key' }, query: { serialNumber: 'SERIAL1', macAddress: 'DC:2C:6E:C9:D9:B0' }, headers: {}, ip: '192.0.2.1' };

function response() {
  const res: any = { status: jest.fn(), type: jest.fn(), send: jest.fn() };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  return res;
}

beforeEach(() => jest.resetAllMocks());

it('rejects an identity owned by another router without modifying either record', async () => {
  mockPrisma.router.findFirst.mockResolvedValueOnce(router).mockResolvedValueOnce({ id: 'existing' });
  const next = jest.fn();
  await heartbeatBootstrapRouter(request as any, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  expect(mockPrisma.router.update).not.toHaveBeenCalled();
});

it('looks for case-insensitive MAC and serial ownership outside the current asset', async () => {
  mockPrisma.router.findFirst.mockResolvedValueOnce(router).mockResolvedValueOnce({ id: 'existing' });
  await heartbeatBootstrapRouter(request as any, response(), jest.fn());
  expect(mockPrisma.router.findFirst).toHaveBeenNthCalledWith(2, {
    where: { id: { not: 'pilot' }, OR: [
      { serialNumber: { equals: 'SERIAL1', mode: 'insensitive' } },
      { hardwareMac: { equals: 'dc:2c:6e:c9:d9:b0', mode: 'insensitive' } },
    ] }, select: { id: true },
  });
});

it('accepts a fresh identity and records a successful heartbeat', async () => {
  mockPrisma.router.findFirst.mockResolvedValueOnce(router).mockResolvedValueOnce(null);
  mockPrisma.router.update.mockResolvedValue({ id: 'pilot' });
  const res = response();
  const next = jest.fn();
  await heartbeatBootstrapRouter(request as any, res, next);
  expect(res.send).toHaveBeenCalledWith('OK pilot');
  expect(mockPrisma.router.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ hardwareMac: 'dc:2c:6e:c9:d9:b0', status: 'ONLINE' }) }));
  expect(next).not.toHaveBeenCalled();
});

it('reports concurrent unique-identity claims as a conflict rather than HTTP 500', async () => {
  mockPrisma.router.findFirst.mockResolvedValueOnce(router).mockResolvedValueOnce(null);
  mockPrisma.router.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test', meta: { target: ['hardwareMac'] } }));
  const next = jest.fn();
  await heartbeatBootstrapRouter(request as any, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
});
