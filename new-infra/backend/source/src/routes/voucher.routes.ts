import { Router } from 'express';
import { listVouchers, createVoucherBatch, cancelVoucher } from '../controllers/voucher.controller';
import { authenticate, requireDashboardRole, requireTenant } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireDashboardRole, requireTenant);

router.get('/', listVouchers);
router.post('/', createVoucherBatch);
router.delete('/:id', cancelVoucher);

export default router;
