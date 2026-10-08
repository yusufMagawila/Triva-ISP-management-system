import { Router } from 'express';
import { authenticate, requireDashboardRole } from '../middleware/auth';
import {
  getPaymentSettings,
  updatePaymentSettings,
  testPaymentGateway,
} from '../controllers/payment-settings.controller';

const router = Router();

router.get('/', authenticate, requireDashboardRole, getPaymentSettings);
router.put('/', authenticate, requireDashboardRole, updatePaymentSettings);
router.post('/test', authenticate, requireDashboardRole, testPaymentGateway);

export default router;
