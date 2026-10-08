import { Router } from 'express';
import { authenticate, requireDashboardRole } from '../middleware/auth';
import { getPortalSettings, updatePortalSettings } from '../controllers/portal-settings.controller';

const router = Router();

router.get('/', authenticate, requireDashboardRole, getPortalSettings);
router.put('/', authenticate, requireDashboardRole, updatePortalSettings);

export default router;
