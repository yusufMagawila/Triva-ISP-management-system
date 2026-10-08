import { Router } from 'express';
import { body } from 'express-validator';
import {
  listRouters,
  createRouter,
  getRouter,
  updateRouter,
  deleteRouter,
  pingRouter,
  getRouterActiveSessions,
  getRouterSetupScript,
} from '../controllers/router.controller';
import { authenticate, requireDashboardRole, requireTenant, validateTenantAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireDashboardRole, requireTenant, validateTenantAccess);

router.get('/', listRouters);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('serialNumber').optional().trim(),
    body('hardwareMac').optional().trim(),
    body('hotspotName').optional().trim(),
  ],
  validate,
  createRouter
);

router.get('/:id', getRouter);

router.patch(
  '/:id',
  [body('name').optional().trim().notEmpty()],
  validate,
  updateRouter
);

router.delete('/:id', deleteRouter);

router.post('/:id/ping', pingRouter);

router.get('/:id/active-sessions', getRouterActiveSessions);

router.get('/:id/setup-script', getRouterSetupScript);

export default router;
