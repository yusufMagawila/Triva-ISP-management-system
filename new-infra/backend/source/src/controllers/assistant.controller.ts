import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import {
  runAssistantTurn,
  applyAssistantActions,
  assistantHistorySchema,
  assistantActionSchema,
  type AssistantAction,
} from '../services/ai/merchant-assistant.service';
import { AIUnavailableError, AIMalformedResponseError } from '../services/ai/ai-provider';
import { z } from 'zod';

const messageBodySchema = z.object({
  history: assistantHistorySchema,
}).strict();

const applyBodySchema = z.object({
  actions: z.array(assistantActionSchema).min(1).max(6),
}).strict();

/**
 * POST /api/assistant/message — one assistant turn. Returns a reply and
 * optionally a proposed set of changes the user must confirm.
 */
export async function assistantMessage(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Tenant context is required' });
      return;
    }
    const parsed = messageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'history must be an array of {role, content} messages' });
      return;
    }

    const turn = await runAssistantTurn(tenantId, parsed.data.history);
    res.json({ success: true, data: turn });
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      res.status(503).json({ success: false, error: 'AI provider is not configured' });
      return;
    }
    if (err instanceof AIMalformedResponseError) {
      res.status(502).json({ success: false, error: 'Assistant returned an invalid response' });
      return;
    }
    next(err);
  }
}

/**
 * POST /api/assistant/apply — applies a user-confirmed proposal. Actions are
 * re-validated against the closed vocabulary here, never trusted from the
 * client or the model.
 */
export async function assistantApply(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Tenant context is required' });
      return;
    }
    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'actions must be a list of supported assistant actions' });
      return;
    }

    const results = await applyAssistantActions(tenantId, req.user!.userId, parsed.data.actions as AssistantAction[]);
    res.json({ success: results.every((r) => r.ok), data: results });
  } catch (err) {
    next(err);
  }
}
