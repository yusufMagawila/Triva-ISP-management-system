import { describe, it, expect, afterEach, jest } from '@jest/globals';

jest.mock('../../../config/env', () => ({
  env: { AI_PROVIDER: 'deterministic', GEMINI_API_KEY: undefined, GEMINI_MODEL: 'test' },
}));

import { runInterviewTurn, onboardingProfileSchema } from '../onboarding.service';
import { setAIProvider, AIMalformedResponseError, AIUnavailableError, DeterministicProvider, AIProvider } from '../ai-provider';
import { listImplementedActions } from '../../installation/action-executor.service';

afterEach(() => setAIProvider(undefined));

function providerReturning(output: unknown): AIProvider {
  return { name: 'mock', available: true, generateJson: jest.fn(async () => output) };
}

const GOOD_PROFILE = {
  shopName: 'Mama Neema Cafe',
  welcomeMessage: 'Karibu! Enjoy fast WiFi.',
  brandColor: '#ff8800',
  plans: [
    { name: '1 Hour', price: 500, durationMins: 60 },
    { name: 'Daily', price: 2000, durationMins: 1440, downloadKbps: 5000, uploadKbps: 2000 },
  ],
};

describe('onboarding interview', () => {
  it('returns the next question while info is missing', async () => {
    setAIProvider(providerReturning({ status: 'asking', question: 'What is the shop name?' }));
    const turn = await runInterviewTurn([], {});
    expect(turn).toEqual({ status: 'asking', question: 'What is the shop name?' });
  });

  it('returns a validated profile when ready', async () => {
    setAIProvider(providerReturning({ status: 'ready', message: 'All set', profile: GOOD_PROFILE }));
    const turn = await runInterviewTurn([{ role: 'user', content: 'Mama Neema Cafe' }], {});
    expect(turn.status).toBe('ready');
    if (turn.status === 'ready') expect(turn.profile.plans).toHaveLength(2);
  });

  it('rejects out-of-range prices and durations from the AI', async () => {
    setAIProvider(providerReturning({
      status: 'ready',
      profile: { shopName: 'X Shop', plans: [{ name: 'Free', price: 0, durationMins: 60 }] },
    }));
    await expect(runInterviewTurn([], {})).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects unknown fields (no smuggled commands)', async () => {
    setAIProvider(providerReturning({
      status: 'ready',
      profile: { ...GOOD_PROFILE, routerCommand: '/system reset-configuration' },
    }));
    await expect(runInterviewTurn([], {})).rejects.toThrow(AIMalformedResponseError);
  });

  it('rejects malformed colours and more than 8 plans', () => {
    expect(onboardingProfileSchema.safeParse({ ...GOOD_PROFILE, brandColor: 'orange' }).success).toBe(false);
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, price: 500, durationMins: 60 }));
    expect(onboardingProfileSchema.safeParse({ ...GOOD_PROFILE, plans: many }).success).toBe(false);
  });

  it('reports AI unavailable instead of faking an interview with the deterministic provider', async () => {
    setAIProvider(new DeterministicProvider());
    await expect(runInterviewTurn([], {})).rejects.toThrow(AIUnavailableError);
  });
});

describe('onboarding actions are allowlisted', () => {
  it('registers APPLY_PORTAL_BRANDING and CREATE_PLANS as implemented', () => {
    const implemented = listImplementedActions();
    expect(implemented).toContain('APPLY_PORTAL_BRANDING');
    expect(implemented).toContain('CREATE_PLANS');
  });
});
