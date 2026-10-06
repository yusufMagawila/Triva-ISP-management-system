import { Router } from 'express';
import { body } from 'express-validator';
import { listPlans, createPlan, updatePlan, deletePlan } from '../controllers/plan.controller';
import { authenticate, requireTenant, validateTenantAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireTenant, validateTenantAccess);

router.get('/', listPlans);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('price').isFloat({ min: 0 }),
    body('durationMins').isInt({ min: 1 }),
    body('downloadKbps').optional().isInt({ min: 0 }),
    body('uploadKbps').optional().isInt({ min: 0 }),
  ],
  validate,
  createPlan
);

router.patch('/:id', validate, updatePlan);

router.delete('/:id', deletePlan);

export default router;
