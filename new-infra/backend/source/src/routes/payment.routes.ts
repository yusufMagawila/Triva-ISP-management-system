import { Router } from 'express';
import { body } from 'express-validator';
import {
  initiatePortalPayment,
  listPayments,
  getEarningsSummary,
} from '../controllers/payment.controller';
import { handleAnypayWebhook } from '../controllers/anypay-webhook.controller';
import { authenticate, requireTenant, validateTenantAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { validateWebhookToken } from '../middleware/webhook-auth';

const router = Router();

// Portal-facing (public) — no auth
router.post(
  '/portal/initiate',
  [
    body('tenantId').notEmpty(),
    body('routerId').notEmpty(),
    body('planId').notEmpty(),
    body('macAddress').notEmpty(),
    body('phone').isMobilePhone('any'),
  ],
  validate,
  initiatePortalPayment
);

// AnyPay webhook (public but authenticated by the tenant webhook token)
router.post('/webhook/anypay/:token', validateWebhookToken, handleAnypayWebhook);

// Dashboard routes (authenticated)
router.get('/earnings', authenticate, requireTenant, validateTenantAccess, getEarningsSummary);
router.get('/', authenticate, requireTenant, validateTenantAccess, listPayments);

export default router;
