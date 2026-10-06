import { Router } from 'express';
import { body } from 'express-validator';
import {
  listTpLinkRouters,
  createTpLinkRouter,
  getTpLinkRouter,
  updateTpLinkRouter,
  deleteTpLinkRouter,
  pingTpLinkRouter,
  getTpLinkRouterActiveSessions,
} from '../controllers/tplink-router.controller';
import { authenticate, requireTenant, validateTenantAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireTenant, validateTenantAccess);

router.get('/', listTpLinkRouters);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('serialNumber').optional().trim(),
    body('hardwareMac').optional().trim(),
    body('openwrtVersion').optional().trim(),
  ],
  validate,
  createTpLinkRouter
);

router.get('/:id', getTpLinkRouter);

router.patch(
  '/:id',
  [body('name').optional().trim().notEmpty()],
  validate,
  updateTpLinkRouter
);

router.delete('/:id', deleteTpLinkRouter);

router.post('/:id/ping', pingTpLinkRouter);

router.get('/:id/active-sessions', getTpLinkRouterActiveSessions);

export default router;
