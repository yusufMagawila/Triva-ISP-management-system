import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getPortalSettings, updatePortalSettings } from '../controllers/portal-settings.controller';

const router = Router();

router.get('/', authenticate, getPortalSettings);
router.put('/', authenticate, updatePortalSettings);

export default router;
