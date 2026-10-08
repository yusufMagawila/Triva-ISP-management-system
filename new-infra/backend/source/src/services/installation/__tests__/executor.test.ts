import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock prisma + audit so the executor runs without a database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  installation: { findUnique: jest.fn(), update: jest.fn() },
  router: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  tpLinkRouter: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  omadaSite: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  tenant: { findUnique: jest.fn() },
  $executeRaw: jest.fn(),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAudit: any = jest.fn(async () => undefined);

jest.mock('../../../config/prisma', () => ({ prisma: mockPrisma }));
jest.mock('../../audit.service', () => ({ recordAudit: mockAudit }));

import { executeActions } from '../action-executor.service';

const INSTALLATION = {
  id: 'inst-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  installerId: 'installer-1',
  status: 'IN_PROGRESS',
  approvals: null,
  executionResults: [],
};

const CTX = {
  actor: { userId: 'installer-1', role: 'INSTALLER', tenantId: 'tenant-1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.installation.findUnique.mockResolvedValue(INSTALLATION);
  mockPrisma.installation.update.mockResolvedValue(INSTALLATION);
});

describe('executeActions — closed vocabulary', () => {
  it('rejects arbitrary shell/RouterOS commands as UNKNOWN_ACTION', async () => {
    const { results } = await executeActions('inst-1', [
      { type: 'execute_shell', params: { command: '/system reboot' } },
      { type: 'routeros_run', params: { command: '/ip address add address=1.2.3.4' } },
    ], CTX);
    expect(results[0].status).toBe('DENIED');
    expect(results[0].error).toMatch(/Unknown action/);
    expect(results[1].status).toBe('DENIED');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACTION_DENIED' }));
  });

  it('returns NOT_IMPLEMENTED for declared-but-unwired actions', async () => {
    const { results } = await executeActions('inst-1', [
      { type: 'CONFIGURE_WAN', params: {} },
      { type: 'CONFIGURE_DATA_CAP', params: { mb: 100 } },
    ], CTX);
    expect(results[0].status).toBe('NOT_IMPLEMENTED');
    expect(results[1].status).toBe('NOT_IMPLEMENTED');
  });

  it('rejects malformed action requests', async () => {
    const { results } = await executeActions('inst-1', [{ nope: true }], CTX);
    expect(results[0].status).toBe('FAILED');
  });
});

describe('executeActions — scoping', () => {
  it('denies actions when the installation belongs to another tenant', async () => {
    mockPrisma.installation.findUnique.mockResolvedValue({ ...INSTALLATION, tenantId: 'tenant-2' });
    const { results } = await executeActions('inst-1', [{ type: 'READ_ROUTER_IDENTITY', params: { assetId: 'r1' } }], CTX);
    expect(results[0].status).toBe('DENIED');
  });

  it('denies scoped tokens bound to a different installation', async () => {
    const { results } = await executeActions('inst-1', [{ type: 'READ_ROUTER_IDENTITY', params: { assetId: 'r1' } }], {
      ...CTX,
      tokenScope: { installationId: 'inst-other' },
    });
    expect(results[0].status).toBe('DENIED');
  });

  it('blocks actions on terminal installations', async () => {
    mockPrisma.installation.findUnique.mockResolvedValue({ ...INSTALLATION, status: 'COMPLETED' });
    const { results } = await executeActions('inst-1', [{ type: 'READ_ROUTER_IDENTITY', params: { assetId: 'r1' } }], CTX);
    expect(results[0].status).toBe('DENIED');
    expect(results[0].error).toMatch(/COMPLETED/);
  });
});

describe('executeActions — device ownership + claim', () => {
  it('blocks claiming another tenant\'s device (DEVICE_ALREADY_ASSIGNED)', async () => {
    mockPrisma.router.findUnique.mockResolvedValue({
      id: 'r1', tenantId: 'tenant-OTHER', siteId: null, serialNumber: 'SN0001', hardwareMac: 'aa:bb:cc:dd:ee:ff',
    });
    const { results } = await executeActions('inst-1', [
      { type: 'CLAIM_DEVICE', params: { vendor: 'MIKROTIK', assetId: 'r1', serialNumber: 'SN0001' } },
    ], CTX);
    expect(results[0].status).toBe('DENIED');
    expect(results[0].error).toBe('DEVICE_ALREADY_ASSIGNED');
  });

  it('blocks claiming on identity mismatch (DEVICE_IDENTITY_MISMATCH)', async () => {
    mockPrisma.router.findUnique.mockResolvedValue({
      id: 'r1', tenantId: 'tenant-1', siteId: 'site-1', serialNumber: 'SN-REAL', hardwareMac: null,
    });
    const { results } = await executeActions('inst-1', [
      { type: 'CLAIM_DEVICE', params: { vendor: 'MIKROTIK', assetId: 'r1', serialNumber: 'SN-WRONG' } },
    ], CTX);
    expect(results[0].status).toBe('DENIED');
    expect(results[0].error).toBe('DEVICE_IDENTITY_MISMATCH');
  });

  it('claims a device when identity matches and binds it to the site', async () => {
    mockPrisma.router.findUnique.mockResolvedValue({
      id: 'r1', tenantId: 'tenant-1', siteId: 'site-1', serialNumber: 'SN0001', hardwareMac: null,
    });
    mockPrisma.router.update.mockResolvedValue({});
    const { results, allOk } = await executeActions('inst-1', [
      { type: 'CLAIM_DEVICE', params: { vendor: 'MIKROTIK', assetId: 'r1', serialNumber: 'sn0001' } },
    ], CTX);
    expect(allOk).toBe(true);
    expect(results[0].status).toBe('OK');
    expect(mockPrisma.router.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ siteId: 'site-1' }) })
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_CLAIMED' }));
  });
});

describe('executeActions — results persisted + secrets never leak', () => {
  it('appends ordered results onto the installation row', async () => {
    mockPrisma.router.findUnique.mockResolvedValue({
      id: 'r1', tenantId: 'tenant-1', siteId: 'site-1', serialNumber: 'SN0001', hardwareMac: 'aa:bb:cc:dd:ee:ff',
      name: 'gw', discovery: null,
    });
    await executeActions('inst-1', [{ type: 'READ_ROUTER_IDENTITY', params: { assetId: 'r1' } }], CTX);
    expect(mockPrisma.installation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inst-1' },
        data: expect.objectContaining({ executionResults: expect.any(Array) }),
      })
    );
  });

  it('sanitizes action evidence before recording', async () => {
    mockPrisma.router.findUnique.mockResolvedValue({
      id: 'r1', tenantId: 'tenant-1', siteId: 'site-1',
      serialNumber: 'SN0001', hardwareMac: 'aa:bb:cc:dd:ee:ff',
      name: 'gw', discovery: null,
      passwordHash: 'SHOULD_NOT_SURFACE', passwordEnc: 'enc:tag:ct',
      provisioningKey: 'trk_x',
      ipAddress: '10.251.0.10', apiPort: 8728, username: 'triva-agent', hotspotName: 'hotspot1',
    });
    const { results } = await executeActions('inst-1', [{ type: 'READ_ROUTER_IDENTITY', params: { assetId: 'r1' } }], CTX);
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain('SHOULD_NOT_SURFACE');
    expect(serialized).not.toContain('enc:tag:ct');
  });
});
