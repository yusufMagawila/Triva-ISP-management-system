import { describe, it, expect, afterEach, jest } from '@jest/globals';

jest.mock('../../../config/env', () => ({
  env: { AI_PROVIDER: 'deterministic', GEMINI_API_KEY: undefined, GEMINI_MODEL: 'test' },
}));

import { generateInstallationPlan, PlanRejectedError } from '../installation-planner.service';
import { diagnose } from '../diagnostic.service';
import { setAIProvider, DeterministicProvider, AIMalformedResponseError, AIProvider } from '../ai-provider';

const CTX = { site: { name: 'ABC Shop — Sinza' }, devices: [{ vendor: 'MIKROTIK', model: 'hAP ac lite' }] };

afterEach(() => setAIProvider(undefined));

function providerReturning(output: unknown): AIProvider {
  return { name: 'mock', available: true, generateJson: jest.fn(async () => output) };
}

describe('generateInstallationPlan — allowlist enforcement', () => {
  it('accepts a valid plan using only allowlisted actions', async () => {
    setAIProvider(providerReturning({
      planVersion: '1',
      summary: 'Discover then test connectivity.',
      actions: [
        { type: 'DISCOVER_ROUTER', reason: 'Read state first' },
        { type: 'RUN_CONNECTIVITY_TEST', reason: 'Confirm reachability' },
      ],
      warnings: [],
      requiresApproval: false,
    }));
    const { plan, rejectedActions } = await generateInstallationPlan(CTX);
    expect(plan.actions).toHaveLength(2);
    expect(rejectedActions).toHaveLength(0);
  });

  it('SECURITY: rejects a plan containing a raw RouterOS command action', async () => {
    // The adversarial case from the spec: AI proposes "execute arbitrary
    // RouterOS command" — not in the vocabulary → whole plan rejected.
    setAIProvider(providerReturning({
      planVersion: '1',
      summary: 'Run this command.',
      actions: [
        { type: 'execute_shell', params: { command: '/system reboot' } },
        { type: 'ROUTEROS_RAW', params: { command: '/ip address add address=1.2.3.4/24 interface=ether1' } },
      ],
      warnings: [],
      requiresApproval: false,
    }));
    await expect(generateInstallationPlan(CTX)).rejects.toThrow(PlanRejectedError);
  });

  it('rejects plans that invent action types', async () => {
    setAIProvider(providerReturning({
      planVersion: '1', summary: 'x',
      actions: [{ type: 'DELETE_ALL_USERS' }], warnings: [], requiresApproval: false,
    }));
    await expect(generateInstallationPlan(CTX)).rejects.toThrow(/non-allowlisted/);
  });

  it('flags allowlisted-but-unimplemented actions instead of pretending they ran', async () => {
    setAIProvider(providerReturning({
      planVersion: '1', summary: 'x',
      actions: [{ type: 'CONFIGURE_WAN' }], warnings: [], requiresApproval: true,
    }));
    const { notImplementedActions } = await generateInstallationPlan(CTX);
    expect(notImplementedActions).toContain('CONFIGURE_WAN');
  });

  it('rejects malformed AI responses (missing required fields)', async () => {
    setAIProvider(providerReturning({ hello: 'world' }));
    await expect(generateInstallationPlan(CTX)).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects plans with extra unknown top-level fields (strict schema)', async () => {
    setAIProvider(providerReturning({
      planVersion: '1', summary: 'x', actions: [], warnings: [], requiresApproval: false,
      executeNow: '/system reboot', // smuggled field
    }));
    await expect(generateInstallationPlan(CTX)).rejects.toThrow(AIMalformedResponseError);
  });
});

describe('DeterministicProvider fallback', () => {
  it('produces a safe read-only plan when no LLM key is configured', async () => {
    setAIProvider(new DeterministicProvider());
    const { plan } = await generateInstallationPlan(CTX);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.actions.every((a) => ['DISCOVER_ROUTER', 'RUN_CONNECTIVITY_TEST'].includes(a.type))).toBe(true);
  });

  it('warns on vendors without a provisioning path', async () => {
    setAIProvider(new DeterministicProvider());
    const { plan } = await generateInstallationPlan({ site: { name: 'x' }, devices: [{ vendor: 'OMADA' }] });
    expect(plan.warnings.some((w) => w.includes('OMADA'))).toBe(true);
  });
});

describe('diagnose — structured interpretation', () => {
  it('returns a schema-valid report', async () => {
    setAIProvider(providerReturning({
      headline: 'Omada unreachable', severity: 'ERROR',
      likelyCauses: ['No DHCP lease', 'PoE issue'],
      recommendedSteps: [{ step: 'Check Ethernet', automatable: false }],
      confidence: 'medium',
    }));
    const report = await diagnose({ omadaReachable: false, mikrotikReachable: true });
    expect(report.severity).toBe('ERROR');
    expect(report.likelyCauses.length).toBeGreaterThan(0);
  });

  it('rejects malformed diagnostic output', async () => {
    setAIProvider(providerReturning({ not: 'a report' }));
    await expect(diagnose({ internet: false })).rejects.toThrow(AIMalformedResponseError);
  });
});
