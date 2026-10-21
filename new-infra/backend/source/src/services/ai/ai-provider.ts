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
    // One automatic retry: the provider occasionally returns a truncated or
    // wrapped reply, or a transient 503 under load. A second try almost always works.
    try {
      return await this.generateJsonOnce(opts);
    } catch (err) {
      const transient =
        err instanceof AIMalformedResponseError &&
        /not valid JSON|empty response|HTTP (429|500|502|503|504)/.test(err.message);
      if (!transient) throw err;
      logger.warn('AI request failed, retrying once', { reason: err.message.slice(0, 120) });
      return this.generateJsonOnce(opts);
    }
  }

  private async generateJsonOnce(opts: AIGenerateOptions): Promise<unknown> {
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
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let reason = '';
      try {
        reason = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        /* non-JSON error body */
      }
      reason = reason.replace(/key=[^\s&]+/gi, 'key=[redacted]').slice(0, 160);
      logger.warn('Gemini request failed', { status: res.status, model: env.GEMINI_MODEL, reason });
      throw new AIMalformedResponseError(
        `AI provider returned HTTP ${res.status} (model ${env.GEMINI_MODEL})${reason ? `: ${reason}` : ''}`,
        body.slice(0, 200)
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new AIMalformedResponseError('AI provider returned empty response');

    const parsed = parseJsonLoose(text);
    if (parsed === undefined) {
      logger.warn('AI reply was not valid JSON', {
        finishReason: (candidate as { finishReason?: string } | undefined)?.finishReason,
        length: text.length,
      });
      throw new AIMalformedResponseError('AI response was not valid JSON', text.slice(0, 300));
    }
    return parsed;
  }
}

/** JSON.parse that also accepts ```json fences and leading/trailing prose. */
export function parseJsonLoose(text: string): unknown {
  const attempts = [text.trim(), text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const a of attempts) {
    try { return JSON.parse(a); } catch { /* try next */ }
  }
  return undefined;
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
