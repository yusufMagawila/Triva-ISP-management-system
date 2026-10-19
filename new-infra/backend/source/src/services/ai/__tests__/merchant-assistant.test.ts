import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const prismaMock = {
  tenant: { findUnique: jest.fn(), update: jest.fn() },
  plan: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  voucher: { findUnique: jest.fn(), createMany: jest.fn() },
};
const auditMock = jest.fn();

jest.mock('../../../config/env', () => ({
  env: { AI_PROVIDER: 'deterministic', GEMINI_API_KEY: undefined, GEMINI_MODEL: 'test' },
}));
jest.mock('../../../config/prisma', () => ({ prisma: prismaMock }));
jest.mock('../../audit.service', () => ({ recordAudit: auditMock }));

import {
  runAssistantTurn,
  applyAssistantActions,
  assistantActionSchema,
} from '../merchant-assistant.service';
import { setAIProvider, AIMalformedResponseError, AIUnavailableError, AIProvider } from '../ai-provider';

afterEach(() => setAIProvider(undefined));

function providerReturning(output: unknown): AIProvider {
  return { name: 'mock', available: true, generateJson: jest.fn(async () => output) };
}

const TENANT = {
  portalNoticeName: 'Shop', portalNoticeMessage: null, portalNoticeColor: '#2563eb',
  portalTheme: 'classic', portalSeasonal: 'auto',
  anypayEnabled: true, anypayApiKeyEnc: 'enc', anypayApiKey: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.tenant.findUnique.mockResolvedValue(TENANT as never);
  prismaMock.plan.findMany.mockResolvedValue([
    { id: 'plan-1', name: '1 Hour', price: 500, durationMins: 60, status: 'ACTIVE' },
  ] as never);
  prismaMock.tenant.update.mockResolvedValue({} as never);
});

describe('merchant assistant turn', () => {
  it('returns a plain reply', async () => {
    setAIProvider(providerReturning({ reply: 'Sure, what price should it be?' }));
    const turn = await runAssistantTurn('ten-1', [{ role: 'user', content: 'change 1 hour price' }]);
    expect(turn.reply).toContain('price');
    expect(turn.proposal).toBeUndefined();
  });

  it('returns a validated proposal', async () => {
    setAIProvider(providerReturning({
      reply: 'Here is the change.',
      proposal: { summary: 'Set 1 Hour to 800 TZS', actions: [{ type: 'UPDATE_PLAN', planId: 'plan-1', changes: { price: 800 } }] },
    }));
    const turn = await runAssistantTurn('ten-1', []);
    expect(turn.proposal?.actions).toHaveLength(1);
  });

  it('rejects out-of-bounds values (price below 100)', async () => {
    setAIProvider(providerReturning({
      reply: 'Done',
      proposal: { summary: 'Free plan', actions: [{ type: 'CREATE_PLANS', plans: [{ name: 'Free', price: 0, durationMins: 60 }] }] },
    }));
    await expect(runAssistantTurn('ten-1', [])).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects unknown action types', async () => {
    setAIProvider(providerReturning({
      reply: 'Done',
      proposal: { summary: 'x', actions: [{ type: 'RESET_ROUTER', command: '/system reset' }] },
    }));
    await expect(runAssistantTurn('ten-1', [])).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects proposals referencing plans outside the tenant', async () => {
    setAIProvider(providerReturning({
      reply: 'Done',
      proposal: { summary: 'x', actions: [{ type: 'UPDATE_PLAN', planId: 'other-tenant-plan', changes: { price: 0 } }] },
    }));
    await expect(runAssistantTurn('ten-1', [])).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects smuggled extra fields', async () => {
    setAIProvider(providerReturning({ reply: 'hi', apiKey: 'secret' }));
    await expect(runAssistantTurn('ten-1', [])).rejects.toThrow(AIMalformedResponseError);
  });

  it('throws AIUnavailableError when no provider is configured', async () => {
    await expect(runAssistantTurn('ten-1', [])).rejects.toThrow(AIUnavailableError);
  });
});

describe('assistantActionSchema', () => {
  it('accepts every supported action', () => {
    const good = [
      { type: 'APPLY_PORTAL_BRANDING', portalNoticeColor: '#ff0000' },
      { type: 'CREATE_PLANS', plans: [{ name: 'Daily', price: 2000, durationMins: 1440 }] },
      { type: 'UPDATE_PLAN', planId: 'p', changes: { price: 700 } },
      { type: 'SET_PORTAL_THEME', theme: 'ocean' },
      { type: 'SET_PORTAL_SEASONAL', mode: 'nyerere_day' },
      { type: 'CREATE_VOUCHERS', planId: 'p', quantity: 10 },
    ];
    for (const a of good) expect(assistantActionSchema.safeParse(a).success).toBe(true);
  });

  it('rejects unsupported types and unbounded values', () => {
    const bad = [
      { type: 'RUN_COMMAND', command: 'x' },
      { type: 'SET_PORTAL_THEME', theme: 'hacker' },
      { type: 'CREATE_VOUCHERS', planId: 'p', quantity: 500 },
      { type: 'APPLY_PORTAL_BRANDING', portalNoticeColor: 'javascript:alert(1)' },
    ];
    for (const a of bad) expect(assistantActionSchema.safeParse(a).success).toBe(false);
  });
});

describe('applyAssistantActions', () => {
  it('updates branding on the tenant', async () => {
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'APPLY_PORTAL_BRANDING', portalNoticeName: 'New Name', portalNoticeColor: '#00ff00' },
    ]);
    expect(r.ok).toBe(true);
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'ten-1' },
      data: { portalNoticeName: 'New Name', portalNoticeColor: '#00ff00' },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'AI_ASSISTANT_APPLIED', tenantId: 'ten-1' }));
  });

  it('skips existing plan names on CREATE_PLANS', async () => {
    prismaMock.plan.findMany.mockResolvedValue([{ name: '1 Hour' }] as never);
    prismaMock.plan.create.mockResolvedValue({} as never);
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'CREATE_PLANS', plans: [
        { name: '1 Hour', price: 500, durationMins: 60 },
        { name: 'Weekly', price: 9000, durationMins: 10080 },
      ] },
    ]);
    expect(r.ok).toBe(true);
    expect(prismaMock.plan.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'ten-1', name: 'Weekly' }) }),
    );
  });

  it('fails UPDATE_PLAN when the plan is not in this tenant', async () => {
    prismaMock.plan.findFirst.mockResolvedValue(null as never);
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'UPDATE_PLAN', planId: 'foreign-plan', changes: { price: 900 } },
    ]);
    expect(r.ok).toBe(false);
    expect(prismaMock.plan.update).not.toHaveBeenCalled();
  });

  it('applies UPDATE_PLAN scoped to the tenant', async () => {
    prismaMock.plan.findFirst.mockResolvedValue({ id: 'plan-1', name: '1 Hour' } as never);
    prismaMock.plan.update.mockResolvedValue({} as never);
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'UPDATE_PLAN', planId: 'plan-1', changes: { price: 800 }, deactivate: true },
    ]);
    expect(r.ok).toBe(true);
    expect(prismaMock.plan.findFirst).toHaveBeenCalledWith({ where: { id: 'plan-1', tenantId: 'ten-1' } });
    expect(prismaMock.plan.update).toHaveBeenCalledWith({ where: { id: 'plan-1' }, data: { price: 800, status: 'INACTIVE' } });
  });

  it('rejects vouchers for a foreign or inactive plan', async () => {
    prismaMock.plan.findFirst.mockResolvedValue(null as never);
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'CREATE_VOUCHERS', planId: 'x', quantity: 5 },
    ]);
    expect(r.ok).toBe(false);
    expect(prismaMock.voucher.createMany).not.toHaveBeenCalled();
  });

  it('creates vouchers for an active tenant plan', async () => {
    prismaMock.plan.findFirst.mockResolvedValue({ id: 'plan-1', name: '1 Hour' } as never);
    prismaMock.voucher.findUnique.mockResolvedValue(null as never);
    prismaMock.voucher.createMany.mockResolvedValue({} as never);
    const [r] = await applyAssistantActions('ten-1', 'u-1', [
      { type: 'CREATE_VOUCHERS', planId: 'plan-1', quantity: 5 },
    ]);
    expect(r.ok).toBe(true);
    const arg = prismaMock.voucher.createMany.mock.calls[0][0] as { data: Array<{ tenantId: string; planId: string }> };
    expect(arg.data).toHaveLength(5);
    expect(arg.data.every((v) => v.tenantId === 'ten-1' && v.planId === 'plan-1')).toBe(true);
  });
});
