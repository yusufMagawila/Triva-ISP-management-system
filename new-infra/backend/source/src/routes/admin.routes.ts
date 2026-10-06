import { Router } from 'express';
import { body } from 'express-validator';
import {
  getDashboardStats,
  listTenants,
  createTenant,
  updateTenantStatus,
  renewTenantSubscription,
} from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireRole('SUPER_ADMIN'));

router.get('/stats', getDashboardStats);
router.get('/tenants', listTenants);

router.post(
  '/tenants',
  [
    body('name').trim().notEmpty(),
    body('slug').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('merchantEmail').isEmail().normalizeEmail(),
    body('merchantPassword').isLength({ min: 8 }),
    body('merchantName').trim().notEmpty(),
  ],
  validate,
  createTenant
);

router.patch('/tenants/:id/status', updateTenantStatus);
router.post('/tenants/:id/subscription/renew', renewTenantSubscription);

export default router;
