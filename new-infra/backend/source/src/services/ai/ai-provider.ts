/**
 * AI provider abstraction — the ONLY boundary between Triva and an LLM.
 *
 * Rules (spec §1/§24):
 * - Providers return STRICT structured output — raw text is parsed then
 *   schema-validated before it touches anything else.
 * - AI output is a *recommendation*, never an execution. The deterministic
 *   engine re-gates every action through the policy validator.
 * - API keys stay server-side; providers are selected by configuration.
 * - No provider is hardcoded: getAIProvider() resolves from env.
 */

import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export class AIUnavailableError extends Error {
  constructor(msg = 'AI provider is not configured') {
    super(msg);
    this.name = 'AIUnavailableError';
    (this as { statusCode?: number; isOperational?: boolean }).statusCode = 503;
    (this as { statusCode?: number; isOperational?: boolean }).isOperational = true;
  }
}

export class AIMalformedResponseError extends Error {
  constructor(msg: string, public readonly raw?: string) {
    super(msg);
    this.name = 'AIMalformedResponseError';
    (this as { statusCode?: number; isOperational?: boolean }).statusCode = 502;
    (this as { statusCode?: number; isOperational?: boolean }).isOperational = true;
  }
}

export interface AIGenerateOptions {
  /** System-level instruction (context + rules). */
  system: string;
  /** The structured input the model reasons over. */
  user: string;
  /** Hint describing required output shape for the provider. */
  responseFormatDescription?: string;
}

export interface AIProvider {
  readonly name: string;
  readonly available: boolean;
  /**
   * Generate and return parsed JSON. The caller schema-validates the result —
   * the provider just guarantees it returns *parsed* JSON or throws.
   */
  generateJson(opts: AIGenerateOptions): Promise<unknown>;
}

// ─── Gemini provider (fetch-based, no SDK dependency) ────────────────────────

class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  get available(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async generateJson(opts: AIGenerateOptions): Promise<unknown> {
    if (!this.available) throw new AIUnavailableError();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('Gemini request failed', { status: res.status });
      throw new AIMalformedResponseError(`AI provider returned HTTP ${res.status}`, body.slice(0, 200));
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new AIMalformedResponseError('AI provider returned empty response');

    try {
      return JSON.parse(text);
    } catch {
      throw new AIMalformedResponseError('AI response was not valid JSON', text.slice(0, 300));
    }
  }
}

// ─── Local deterministic provider (testing / no-key fallback) ────────────────

/**
 * A provider that returns a deterministic, safe plan without calling any LLM.
 * Useful for tests and for environments without an AI key. It produces a plan
 * consisting ONLY of known-safe read/register actions — provisioning is always
 * flagged requiresApproval.
 */
export class DeterministicProvider implements AIProvider {
  readonly name = 'deterministic';
  readonly available = true;

  async generateJson(opts: AIGenerateOptions): Promise<unknown> {
    const ctx = JSON.parse(opts.user) as { devices?: Array<{ vendor?: string }> };
    const actions: Array<{ type: string; reason: string }> = [];
    const warnings: string[] = [];
    for (const d of ctx.devices ?? []) {
      if (d.vendor === 'MIKROTIK') {
        actions.push({ type: 'DISCOVER_ROUTER', reason: 'Read live RouterOS state before any change.' });
        actions.push({ type: 'RUN_CONNECTIVITY_TEST', reason: 'Confirm API reachability.' });
      } else {
        warnings.push(`Vendor '${d.vendor}' has no automatic provisioning path — manual/controller step required.`);
      }
    }
    return {
      planVersion: '1',
      summary: 'Deterministic fallback plan — AI provider not configured.',
      actions,
      warnings,
      requiresApproval: true,
    };
  }
}

// ─── Resolution ──────────────────────────────────────────────────────────────

let cached: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (cached) return cached;
  switch (env.AI_PROVIDER) {
    case 'gemini':
      cached = new GeminiProvider();
      break;
    case 'deterministic':
    default:
      cached = new DeterministicProvider();
      break;
  }
  return cached;
}

/** For tests. */
export function setAIProvider(p: AIProvider | undefined) {
  cached = p;
}
