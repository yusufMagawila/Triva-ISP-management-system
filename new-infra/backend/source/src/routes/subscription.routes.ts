import { Router } from 'express';
import { body } from 'express-validator';
import {
  getSubscription,
  initiateSubscriptionPayment,
  handleSubscriptionWebhook,
} from '../controllers/subscription.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// Public webhook (no auth)
router.post('/webhook', handleSubscriptionWebhook as any);

// Authenticated routes
router.use(authenticate, requireRole('MERCHANT'));

router.get('/', getSubscription);

router.post(
  '/pay',
  [
    body('plan').isIn(['BASIC', 'STANDARD', 'PREMIUM']),
    body('months').isInt({ min: 1, max: 12 }),
    body('phone').notEmpty(),
  ],
  validate,
  initiateSubscriptionPayment
);

export default router;
