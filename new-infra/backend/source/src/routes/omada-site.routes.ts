import { Router } from 'express';
import { body } from 'express-validator';
import {
  listOmadaSites,
  getOmadaSite,
  createOmadaSite,
  updateOmadaSite,
  markOmadaSiteProvisioned,
  deleteOmadaSite,
  downloadPortalPage,
} from '../controllers/omada-site.controller';
import { authenticate, requireTenant, validateTenantAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireTenant, validateTenantAccess);

router.get('/', listOmadaSites);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('controllerUrl').optional().trim(),
    body('controllerIp').optional().trim(),
    body('ssidName').optional().trim(),
    body('hotspotName').optional().trim(),
    body('location').optional().trim(),
  ],
  validate,
  createOmadaSite
);

router.get('/:id', getOmadaSite);

router.patch(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('controllerUrl').optional().trim(),
    body('controllerIp').optional().trim(),
    body('ssidName').optional().trim(),
    body('location').optional().trim(),
  ],
  validate,
  updateOmadaSite
);

router.delete('/:id', deleteOmadaSite);

router.post('/:id/provision', markOmadaSiteProvisioned);

router.get('/:id/portal-page', downloadPortalPage);

export default router;
