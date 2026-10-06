import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestPrisma, cleanDatabase } from './setup';

// These tests require DATABASE_URL pointing at a test database.
const describeIfDb = process.env.DATABASE_URL?.includes('_test') ? describe : describe.skip;

describeIfDb('Authentication integration', () => {
  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await getTestPrisma().$disconnect();
  });

  it('creates a tenant and user', async () => {
    const tenant = await getTestPrisma().tenant.create({
      data: {
        name: 'Test Shop',
        slug: 'test-shop',
        email: 'test@example.com',
        status: 'ACTIVE',
        users: {
          create: {
            email: 'merchant@example.com',
            passwordHash: 'hashed-password',
            name: 'Test Merchant',
            role: 'MERCHANT',
          },
        },
      },
    });
    expect(tenant.email).toBe('test@example.com');
  });

  it('enforces unique tenant email', async () => {
    await expect(
      getTestPrisma().tenant.create({
        data: {
          name: 'Dup Shop',
          slug: 'dup-shop',
          email: 'test@example.com',
        },
      })
    ).rejects.toThrow();
  });
});
