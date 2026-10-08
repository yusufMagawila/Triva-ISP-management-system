import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  device: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  site: { findUnique: jest.fn() },
  auditLog: { findMany: jest.fn() },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAudit: any = jest.fn(async () => undefined);

jest.mock('../../../config/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../../audit.service', () => ({ recordAudit: mockAudit }));

import {
  registerDevice,
  assignDeviceToSite,
  reassignDevice,
  DeviceConflictError,
} from '../device.service';

const ACTOR = { id: 'installer-1', tenantId: 'tenant-1' };

beforeEach(() => { jest.clearAllMocks(); });

describe('registerDevice — duplicate identity protection', () => {
  it('rejects a duplicate MAC address', async () => {
    mockPrisma.device.findFirst.mockResolvedValue({ id: 'd1', siteId: 's1', status: 'ACTIVE', macAddress: 'AA:BB:CC:DD:EE:FF', serialNumber: 'OTHER', barcodeValue: 'OTHER' });
    await expect(registerDevice('tenant-1', ACTOR.id, {
      vendor: 'MIKROTIK', deviceType: 'ROUTER', macAddress: 'aa:bb:cc:dd:ee:ff',
    })).rejects.toThrow(DeviceConflictError);
    expect(mockPrisma.device.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate serial number', async () => {
    mockPrisma.device.findFirst.mockResolvedValue({ id: 'd1', siteId: null, status: 'UNASSIGNED', serialNumber: 'F43E0FEFA14C', macAddress: 'X', barcodeValue: 'X' });
    await expect(registerDevice('tenant-1', ACTOR.id, {
      vendor: 'MIKROTIK', deviceType: 'ROUTER', serialNumber: 'f43e0fefa14c',
    })).rejects.toThrow(DeviceConflictError);
  });

  it('rejects a duplicate barcode', async () => {
    mockPrisma.device.findFirst.mockResolvedValue({ id: 'd1', siteId: null, status: 'UNASSIGNED', serialNumber: 'S1', macAddress: 'M1', barcodeValue: 'BC-999' });
    await expect(registerDevice('tenant-1', ACTOR.id, {
      vendor: 'OMADA', deviceType: 'ACCESS_POINT', barcodeValue: 'BC-999',
    })).rejects.toThrow(DeviceConflictError);
  });

  it('registers a fresh device and audits it', async () => {
    mockPrisma.device.findFirst.mockResolvedValue(null);
    mockPrisma.device.create.mockResolvedValue({ id: 'd-new', siteId: null });
    await registerDevice('tenant-1', ACTOR.id, { vendor: 'MIKROTIK', deviceType: 'ROUTER', serialNumber: 'F43E0FEFA14C' });
    expect(mockPrisma.device.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-1', serialNumber: 'F43E0FEFA14C' }),
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_REGISTERED' }));
  });
});

describe('assignDeviceToSite', () => {
  const device = { id: 'd1', tenantId: 'tenant-1', siteId: null };
  const site = { id: 'site-1', tenantId: 'tenant-1' };

  it('assigns a device to a site and audits it', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(device);
    mockPrisma.site.findUnique.mockResolvedValue(site);
    mockPrisma.device.update.mockResolvedValue({ ...device, siteId: 'site-1' });
    await assignDeviceToSite('d1', 'site-1', ACTOR, { installationId: 'inst-1' });
    expect(mockPrisma.device.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ siteId: 'site-1', status: 'INSTALLING', installationId: 'inst-1' }),
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_ASSIGNED' }));
  });

  it('refuses cross-site assignment without the reassign workflow', async () => {
    mockPrisma.device.findUnique.mockResolvedValue({ ...device, siteId: 'site-OTHER' });
    mockPrisma.site.findUnique.mockResolvedValue(site);
    await expect(assignDeviceToSite('d1', 'site-1', ACTOR)).rejects.toThrow(/DEVICE_ALREADY_ASSIGNED/);
    expect(mockPrisma.device.update).not.toHaveBeenCalled();
  });

  it('denies assigning another tenant\'s device', async () => {
    mockPrisma.device.findUnique.mockResolvedValue({ ...device, tenantId: 'tenant-2' });
    mockPrisma.site.findUnique.mockResolvedValue(site);
    await expect(assignDeviceToSite('d1', 'site-1', ACTOR)).rejects.toThrow(/not found/i);
  });

  it('denies assignment to another tenant\'s site', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(device);
    mockPrisma.site.findUnique.mockResolvedValue({ ...site, tenantId: 'tenant-2' });
    await expect(assignDeviceToSite('d1', 'site-1', ACTOR)).rejects.toThrow(/not found/i);
  });
});

describe('reassignDevice — explicit reassignment with reason', () => {
  const device = { id: 'd1', tenantId: 'tenant-1', siteId: 'site-old' };
  const site = { id: 'site-new', tenantId: 'tenant-1' };

  it('requires a non-empty reason', async () => {
    await expect(reassignDevice('d1', 'site-new', '', ACTOR)).rejects.toThrow(/reason/i);
    await expect(reassignDevice('d1', 'site-new', 'ab', ACTOR)).rejects.toThrow(/reason/i);
  });

  it('reassigns and audits who + why', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(device);
    mockPrisma.site.findUnique.mockResolvedValue(site);
    mockPrisma.device.update.mockResolvedValue({ ...device, siteId: 'site-new' });
    await reassignDevice('d1', 'site-new', 'Customer moved the router to the branch office', ACTOR);
    expect(mockPrisma.device.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ siteId: 'site-new' }),
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEVICE_REASSIGNED',
      metadata: expect.objectContaining({ fromSiteId: 'site-old', toSiteId: 'site-new', reason: expect.any(String) }),
    }));
  });

  it('denies reassignment of another tenant\'s device', async () => {
    mockPrisma.device.findUnique.mockResolvedValue({ ...device, tenantId: 'tenant-2' });
    mockPrisma.site.findUnique.mockResolvedValue(site);
    await expect(reassignDevice('d1', 'site-new', 'legit reason', ACTOR)).rejects.toThrow(/not found/i);
  });
});
