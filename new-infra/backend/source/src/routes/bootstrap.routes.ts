import { Router } from 'express';
import {
	acknowledgeBootstrapSyncActivation,
	bootstrapRouter,
	getBootstrapRouterInfo,
	getBootstrapSyncScript,
	heartbeatBootstrapRouter,
} from '../controllers/bootstrap.controller';

const router = Router();

router.get('/router/:provisioningKey', bootstrapRouter);
router.get('/router/:provisioningKey/info', getBootstrapRouterInfo);
router.get('/heartbeat/:provisioningKey', heartbeatBootstrapRouter);
router.get('/sync/:provisioningKey', getBootstrapSyncScript);
router.get('/sync/:provisioningKey/ack/:sessionId', acknowledgeBootstrapSyncActivation);

// Backward-compatible query-based bootstrap routes during migration.
router.get('/router', bootstrapRouter);
router.get('/router/heartbeat', heartbeatBootstrapRouter);

export default router;