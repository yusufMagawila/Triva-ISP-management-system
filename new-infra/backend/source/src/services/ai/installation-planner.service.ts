/**
 * AI installation planner — converts structured installation context into a
 * proposed action plan. Every action is validated against the CLOSED action
 * vocabulary; unknown/forbidden actions reject the whole plan (fail-closed).
 * The AI never executes — the executor re-gates each action anyway.
 */

import { z } from 'zod';
import { getAIProvider, AIUnavailableError, AIMalformedResponseError } from './ai-provider';
import { listImplementedActions, listDeclaredNotImplemented } from '../installation/action-executor.service';
import { getCapabilityRegistry } from '../../config/capabilities';
import { sanitizeSecrets } from '../../lib/sanitize';

// ─── Plan schema (the ONLY shape the AI may return) ──────────────────────────

export const installationPlanSchema = z.object({
  planVersion: z.literal('1'),
  summary: z.string().max(2000),
  actions: z.array(z.object({
    type: z.string().min(1).max(64),
    reason: z.string().max(500).optional(),
    params: z.record(z.unknown()).optional(),
  })).max(50),
  warnings: z.array(z.string().max(500)).max(20).default([]),
  requiresApproval: z.boolean().default(false),
}).strict();

export type InstallationPlan = z.infer<typeof installationPlanSchema>;

// ─── Planner input (structured, sanitized — never raw creds/routers) ─────────

export interface PlannerContext {
  site: { name: string; id?: string };
  customer?: { name?: string };
  devices: Array<{
    vendor: string;
    model?: string;
    deviceType?: string;
    capabilities?: Record<string, unknown>;
    currentState?: Record<string, unknown>;
  }>;
  requirements?: Record<string, unknown>;
}

const PLANNER_SYSTEM = `You are the Triva installation planner. You receive a structured description of a customer site and its physical devices, and you return a STRICT JSON installation plan.

Hard rules — violated output is rejected:
- Return ONLY JSON matching the required schema. No markdown, no prose outside the JSON.
- "actions[].type" MUST be one of the allowlisted action types provided in the input. Never invent actions, never emit raw RouterOS commands, never emit shell commands.
- If the correct action is not in the allowlist, do NOT approximate it — put the need in "warnings" and set requiresApproval=true.
- Do not request credentials. Do not include secrets. Do not include IP credentials in params.
- Order actions so reads/discovery precede writes.
- requiresApproval=true whenever the plan changes device configuration.`;

/** Build the model input — sanitized, allowlist included so the AI can only choose from it. */
export function buildPlannerInput(ctx: PlannerContext) {
  const registry = getCapabilityRegistry(listImplementedActions(), listDeclaredNotImplemented());
  return sanitizeSecrets({
    site: ctx.site,
    customer: ctx.customer,
    devices: ctx.devices,
    requirements: ctx.requirements ?? {},
    allowlistedActions: [...listImplementedActions(), ...listDeclaredNotImplemented()],
    capabilities: { mikrotik: registry.mikrotik, tplink: registry.tplink, omada: registry.omada },
    outputSchema: '{ "planVersion":"1", "summary":"string", "actions":[{"type":"<allowlisted>","reason":"string","params":{}}], "warnings":["string"], "requiresApproval":boolean }',
  });
}

export interface ValidatedPlan {
  plan: InstallationPlan;
  /** Actions the AI proposed that are not allowlisted — plan is rejected if any exist. */
  rejectedActions: string[];
  /** Actions that are allowlisted but NOT_IMPLEMENTED — kept in plan with warning. */
  notImplementedActions: string[];
}

/**
 * Generate + schema-validate + allowlist-check an installation plan.
 * Throws AIUnavailableError / AIMalformedResponseError / PlanRejectedError.
 */
export async function generateInstallationPlan(ctx: PlannerContext): Promise<ValidatedPlan> {
  const provider = getAIProvider();
  if (!provider.available) throw new AIUnavailableError();

  const raw = await provider.generateJson({
    system: PLANNER_SYSTEM,
    user: JSON.stringify(buildPlannerInput(ctx)),
  });

  const parsed = installationPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AIMalformedResponseError(
      `AI plan failed schema validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }

  const plan = parsed.data;
  const allowlist = new Set([...listImplementedActions(), ...listDeclaredNotImplemented()]);
  const implemented = new Set(listImplementedActions());

  const rejectedActions = plan.actions.filter((a) => !allowlist.has(a.type)).map((a) => a.type);
  if (rejectedActions.length) {
    // Fail closed — never partially accept a plan with unknown actions.
    throw new PlanRejectedError(`Plan contains non-allowlisted actions: ${rejectedActions.join(', ')}`);
  }

  const notImplementedActions = plan.actions.filter((a) => !implemented.has(a.type)).map((a) => a.type);
  return { plan, rejectedActions, notImplementedActions };
}

export class PlanRejectedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PlanRejectedError';
    (this as { statusCode?: number }).statusCode = 422;
  }
}
