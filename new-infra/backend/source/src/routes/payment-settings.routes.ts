import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getPaymentSettings,
  updatePaymentSettings,
  testPaymentGateway,
} from '../controllers/payment-settings.controller';

const router = Router();

router.get('/', authenticate, getPaymentSettings);
router.put('/', authenticate, updatePaymentSettings);
router.post('/test', authenticate, testPaymentGateway);

export default router;
