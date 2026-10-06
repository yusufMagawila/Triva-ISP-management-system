import { Router } from 'express';
import { listVouchers, createVoucherBatch, cancelVoucher } from '../controllers/voucher.controller';
import { authenticate, requireTenant } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', listVouchers);
router.post('/', createVoucherBatch);
router.delete('/:id', cancelVoucher);

export default router;
