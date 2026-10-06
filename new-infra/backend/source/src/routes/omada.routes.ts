import { Router } from 'express';
import { body } from 'express-validator';
import {
  getOmadaPortalInfo,
  initiateOmadaPayment,
  redeemOmadaVoucher,
  getOmadaRedirectData,
} from '../controllers/omada.controller';
import { validate } from '../middleware/validate';

const router = Router();

// Public endpoints — no auth required (called by captive portal)

// Get tenant info + plans for an Omada site
router.get('/portal-info', getOmadaPortalInfo);

// Initiate payment for an Omada session
router.post(
  '/initiate-payment',
  [
    body('tenantId').optional(),
    body('siteId').optional(),
    body('planId').notEmpty(),
    body('macAddress').notEmpty(),
    body('phone').isMobilePhone('any'),
  ],
  validate,
  initiateOmadaPayment
);

// Redeem a voucher for an Omada session
router.post(
  '/redeem-voucher',
  [
    body('tenantId').optional(),
    body('siteId').optional(),
    body('macAddress').notEmpty(),
    body('code').notEmpty(),
  ],
  validate,
  redeemOmadaVoucher
);

// Get Omada redirect data (token) after payment is confirmed
router.get('/redirect/:sessionId', getOmadaRedirectData);

export default router;
