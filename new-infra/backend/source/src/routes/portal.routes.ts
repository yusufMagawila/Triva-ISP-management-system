import { Router } from 'express';
import { body } from 'express-validator';
import {
	getPortalInfo,
	checkSessionStatus,
	getRouterHotspotLoginPage,
	getRouterHotspotSyncScript,
	acknowledgeRouterHotspotSyncActivation,
	getTpLinkSplashPage,
	getOmadaCredentials,
	redeemPortalVoucher,
} from '../controllers/portal.controller';
import { validate } from '../middleware/validate';

const router = Router();

// Public endpoints — no auth required
router.get('/router/:routerId', getPortalInfo);
router.get('/router/:routerId/hotspot/login.html', getRouterHotspotLoginPage);
router.get('/router/:routerId/hotspot/flogin.html', getRouterHotspotLoginPage);
router.get('/router/:routerId/hotspot/rlogin.html', getRouterHotspotLoginPage);
router.get('/router/:routerId/hotspot/sync.rsc', getRouterHotspotSyncScript);
router.get('/router/:routerId/hotspot/sync/ack', acknowledgeRouterHotspotSyncActivation);
router.get('/tplink/:routerId/splash.html', getTpLinkSplashPage);
router.get('/session/:sessionId', checkSessionStatus);
router.post(
	'/redeem-voucher',
	[
		body('routerId').notEmpty(),
		body('macAddress').notEmpty(),
		body('code').trim().notEmpty(),
	],
	validate,
	redeemPortalVoucher
);

// Omada integration (RADIUS-based) — token sent via POST body, never in URL
router.post('/omada/credentials', getOmadaCredentials);

export default router;
