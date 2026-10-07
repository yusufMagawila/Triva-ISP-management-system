import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { login, me, changePassword, register, updateSettings, getSettings, initiateActivationPayment, handleActivationWebhook } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { validateActivationWebhookToken } from '../middleware/webhook-auth';

const router = Router();

// Brute-force protection for credential endpoints. The global limiter
// (200/15min) is too permissive for password guessing; allow bursts for
// a few users sharing one NAT address but stop credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, please try again later' },
});

router.post(
  '/register',
  authLimiter,
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
  authLimiter,
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
router.post('/activation-webhook/:token', validateActivationWebhookToken, handleActivationWebhook); // public — called by AnyPay

export default router;
