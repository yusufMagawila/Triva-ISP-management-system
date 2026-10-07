import { Request, Response } from 'express';
import { validateWebhookToken, validateActivationWebhookToken } from '../webhook-auth';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';

jest.mock('../../config/prisma', () => ({
  prisma: {
    payment: {
      findFirst: jest.fn(),
    },
  },
}));

describe('Webhook authentication middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    req = { params: {}, body: {}, ip: '127.0.0.1', path: '/api/payments/webhook/anypay/xxx' };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('validateWebhookToken', () => {
    it('rejects requests missing the token', async () => {
      req.body = { order_id: 'ord_123' };
      await validateWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects requests missing the order_id', async () => {
      req.params = { token: 'secret' };
      await validateWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an unknown order', async () => {
      req.params = { token: 'secret' };
      req.body = { order_id: 'ord_123' };
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
      await validateWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a mismatched token using constant-time comparison', async () => {
      req.params = { token: 'wrong-secret' };
      req.body = { order_id: 'ord_123' };
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-1',
        tenant: { webhookSecret: 'correct-secret' },
      });
      await validateWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts a valid token and attaches tenantId', async () => {
      const secret = 'a-valid-webhook-secret';
      req.params = { token: secret };
      req.body = { order_id: 'ord_123' };
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-1',
        tenant: { webhookSecret: secret },
      });
      await validateWebhookToken(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req as any).webhookTenantId).toBe('tenant-1');
    });
  });

  describe('validateActivationWebhookToken', () => {
    it('rejects a missing token', () => {
      req.params = {};
      validateActivationWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an incorrect token', () => {
      req.params = { token: 'wrong' };
      validateActivationWebhookToken(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts the configured activation webhook secret', () => {
      req.params = { token: env.ACTIVATION_WEBHOOK_SECRET };
      validateActivationWebhookToken(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
