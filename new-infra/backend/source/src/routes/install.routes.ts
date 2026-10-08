import { Router } from 'express';
import { authenticate, requireRole, verifyInstallScope } from '../middleware/auth';
import * as ctrl from '../controllers/install.controller';

const router = Router();

// Every install route requires a valid JWT; scoped tokens are additionally
// verified against the InstallerToken table (revocation/expiry checks).
router.use(authenticate, verifyInstallScope);

const FIELD_ROLES = ['INSTALLER', 'MERCHANT', 'SUPER_ADMIN'];
const STAFF_ROLES = ['MERCHANT', 'SUPER_ADMIN'];

// Capability registry — honest report of what the platform can do.
router.get('/capabilities', requireRole(...FIELD_ROLES), ctrl.getCapabilities);

// Customers & sites
router.post('/customers', requireRole(...FIELD_ROLES), ctrl.createCustomer);
router.get('/customers', requireRole(...FIELD_ROLES), ctrl.listCustomers);
router.post('/sites', requireRole(...FIELD_ROLES), ctrl.createSite);
router.get('/sites', requireRole(...FIELD_ROLES), ctrl.listSites);
router.get('/sites/:id', requireRole(...FIELD_ROLES), ctrl.getSite);

// Installations (wizard lifecycle)
router.post('/installations', requireRole(...FIELD_ROLES), ctrl.createInstallation);
router.get('/installations', requireRole(...FIELD_ROLES), ctrl.listInstallations);
router.get('/installations/:id', requireRole(...FIELD_ROLES), ctrl.getInstallation);
router.put('/installations/:id/contract', requireRole(...FIELD_ROLES), ctrl.updateContract);
router.post('/installations/:id/validate', requireRole(...FIELD_ROLES), ctrl.validateInstallation);
router.post('/installations/:id/execute', requireRole(...FIELD_ROLES), ctrl.executeInstallation);
router.post('/installations/:id/transition', requireRole(...FIELD_ROLES), ctrl.transitionInstallation);
router.post('/installations/:id/diagnostics', requireRole(...FIELD_ROLES), ctrl.runDiagnostic);
router.get('/installations/:id/audit', requireRole(...FIELD_ROLES), ctrl.getInstallationAudit);

// Installation secrets — write-only; values never readable via API.
router.post('/installations/:id/secrets', requireRole(...FIELD_ROLES), ctrl.createInstallationSecret);
router.get('/installations/:id/secrets', requireRole(...FIELD_ROLES), ctrl.listInstallationSecrets);

// Scoped tokens — issue/revoke
router.post('/installations/:id/tokens', requireRole(...FIELD_ROLES), ctrl.issueToken);
router.delete('/installations/:id/tokens/:jti', requireRole(...FIELD_ROLES), ctrl.revokeToken);

// Installer account management + tenant-wide audit: staff only.
router.post('/installers', requireRole(...STAFF_ROLES), ctrl.createInstaller);
router.get('/installers', requireRole(...STAFF_ROLES), ctrl.listInstallers);
router.get('/audit', requireRole(...STAFF_ROLES), ctrl.getTenantAudit);

export default router;
