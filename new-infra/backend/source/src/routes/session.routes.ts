import { Router } from 'express';
import { listSessions, getSession, disconnectSession } from '../controllers/session.controller';
import { authenticate, requireDashboardRole, requireTenant, validateTenantAccess } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireDashboardRole, requireTenant, validateTenantAccess);

router.get('/', listSessions);
router.get('/:id', getSession);
router.post('/:id/disconnect', disconnectSession);

export default router;
