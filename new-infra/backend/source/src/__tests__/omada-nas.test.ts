import { upsertNasClient, removeNasClient } from '../services/device-registry.service';

jest.mock('../config/prisma', () => ({ prisma: {} }));
jest.mock('../lib/crypto', () => ({ decryptRouterCredential: () => 'test-secret', encryptRouterCredential: () => 'encrypted' }));
jest.mock('../services/router-provisioning.service', () => ({}));
jest.mock('../services/tplink-provisioning.service', () => ({}));

const db: any = { $executeRaw: jest.fn() };

beforeEach(() => jest.clearAllMocks());

it('does not register wildcard NAS clients for an absent source', async () => {
  await upsertNasClient('site-1', '', 'encrypted', 'Shop', db);
  expect(db.$executeRaw).not.toHaveBeenCalled();
});

it.each(['%', '0.0.0.0', '0.0.0.0/0', 'example.com', '192.0.2.1/24'])('rejects non-exact IPv4 source %s', async (source) => {
  await expect(upsertNasClient('site-1', source, 'encrypted', 'Shop', db)).rejects.toMatchObject({ statusCode: 400 });
  expect(db.$executeRaw).not.toHaveBeenCalled();
});

it('reports collisions instead of overwriting another site secret', async () => {
  db.$executeRaw.mockResolvedValue(0);
  await expect(upsertNasClient('site-1', '192.0.2.10', 'encrypted', 'Shop', db)).rejects.toMatchObject({ statusCode: 409 });
  const [sql, ...values] = db.$executeRaw.mock.calls[0];
  expect(sql.join('')).toContain('WHERE nas.description LIKE');
  expect(values).toContain('%(site-1)');
});

it('registers an exact source using the supplied transaction', async () => {
  db.$executeRaw.mockResolvedValue(1);
  await upsertNasClient('site-1', '192.0.2.10', 'encrypted', 'Shop', db);
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
});

it('deletes only NAS rows owned by the exact site', async () => {
  await removeNasClient('192.0.2.10', 'site-1', db);
  expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual(['192.0.2.10', '%(site-1)']);
});
