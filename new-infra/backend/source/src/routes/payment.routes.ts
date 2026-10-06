import { Router } from 'express';
import { body } from 'express-validator';
import {
  initiatePortalPayment,
  handleMongikeWebhook,
  handleZenoPayMobileWebhook,
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

// Payment gateway webhooks (public but authenticated by tenant webhook token)
router.post('/webhook/mongike/:token', validateWebhookToken, handleMongikeWebhook);
router.post('/webhook/anypay/:token', validateWebhookToken, handleAnypayWebhook);
router.post('/webhook/zenopaymobile/:token', validateWebhookToken, handleZenoPayMobileWebhook);

// Dashboard routes (authenticated)
router.get('/earnings', authenticate, requireTenant, validateTenantAccess, getEarningsSummary);
router.get('/', authenticate, requireTenant, validateTenantAccess, listPayments);

export default router;
