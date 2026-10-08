/**
 * AI diagnostic assistant — consumes STRUCTURED diagnostic results (booleans,
 * latency, discovery snapshots) and returns an explainable interpretation.
 * It never claims a fix happened; it only recommends next steps.
 */

import { z } from 'zod';
import { getAIProvider, AIUnavailableError, AIMalformedResponseError } from './ai-provider';
import { sanitizeSecrets } from '../../lib/sanitize';

export const diagnosticReportSchema = z.object({
  headline: z.string().max(200),
  severity: z.enum(['OK', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']),
  likelyCauses: z.array(z.string().max(300)).max(10),
  recommendedSteps: z.array(z.object({
    step: z.string().max(300),
    automatable: z.boolean().default(false),
  })).max(10),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
}).strict();

export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;

export interface DiagnosticInput {
  internet?: boolean;
  deviceReachable?: boolean;
  dhcp?: boolean;
  dns?: boolean;
  hotspot?: boolean;
  portal?: boolean;
  omadaReachable?: boolean;
  deviceState?: Record<string, unknown>;
  errors?: string[];
  [k: string]: unknown;
}

const DIAG_SYSTEM = `You are the Triva diagnostic assistant. You receive a STRUCTURED diagnostic result from the deterministic backend and explain it for an installer.

Hard rules:
- Return ONLY JSON matching the schema. No prose outside JSON.
- Base every claim ONLY on the supplied data. Never assert a fix happened — you cannot fix anything.
- recommendedSteps are *recommendations*. automatable=true ONLY for steps the backend could re-run deterministically (e.g. re-discover, re-run connectivity test). Physical steps (check cable, check PoE) are automatable=false.
- confidence reflects how much diagnostic data you actually received.`;

export async function diagnose(input: DiagnosticInput): Promise<DiagnosticReport> {
  const provider = getAIProvider();
  if (!provider.available) throw new AIUnavailableError();

  const raw = await provider.generateJson({
    system: DIAG_SYSTEM,
    user: JSON.stringify(sanitizeSecrets({
      diagnostics: input,
      outputSchema: '{ "headline":"string","severity":"OK|INFO|WARNING|ERROR|CRITICAL","likelyCauses":["string"],"recommendedSteps":[{"step":"string","automatable":boolean}],"confidence":"low|medium|high" }',
    })),
  });

  const parsed = diagnosticReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AIMalformedResponseError(
      `Diagnostic response failed schema validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  return parsed.data;
}
