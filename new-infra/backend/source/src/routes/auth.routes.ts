import { Router } from 'express';
import { body } from 'express-validator';
import { login, me, changePassword, register, updateSettings, getSettings, initiateActivationPayment, handleActivationWebhook } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.post(
  '/register',
  [
    body('shopName').trim().isLength({ min: 2, max: 100 }),
    body('email').isEmail().normalizeEmail(),
    body('merchantName').trim().isLength({ min: 2, max: 100 }),
    body('password').isLength({ min: 8 }),
  ],
  validate,
  register
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ],
  validate,
  login
);

router.get('/me', authenticate, me);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
  ],
  validate,
  changePassword
);

router.get('/settings', authenticate, getSettings);
router.patch('/settings', authenticate, updateSettings);

// Account activation — pay 35,000 TZS one-time fee
router.post('/activate-payment', authenticate, [body('phone').notEmpty()], validate, initiateActivationPayment);
router.post('/activation-webhook', handleActivationWebhook); // public — called by Mongike

export default router;
