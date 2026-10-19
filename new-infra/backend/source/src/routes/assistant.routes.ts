import { Router } from 'express';
import { assistantMessage, assistantApply } from '../controllers/assistant.controller';
import { authenticate, requireDashboardRole, requireTenant } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireDashboardRole, requireTenant);

router.post('/message', assistantMessage);
router.post('/apply', assistantApply);

export default router;
