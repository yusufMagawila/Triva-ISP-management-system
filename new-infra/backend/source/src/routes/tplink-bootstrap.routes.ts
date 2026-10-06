import { Router } from 'express';
import {
	acknowledgeTpLinkSyncActivation,
	bootstrapTpLinkRouter,
	getTpLinkBootstrapRouterInfo,
	getTpLinkBootstrapSyncScript,
	heartbeatTpLinkRouter,
} from '../controllers/tplink-bootstrap.controller';

const router = Router();

router.get('/router/:provisioningKey', bootstrapTpLinkRouter);
router.get('/router/:provisioningKey/info', getTpLinkBootstrapRouterInfo);
router.get('/heartbeat/:provisioningKey', heartbeatTpLinkRouter);
router.get('/sync/:provisioningKey', getTpLinkBootstrapSyncScript);
router.get('/sync/:provisioningKey/ack/:sessionId', acknowledgeTpLinkSyncActivation);

export default router;
