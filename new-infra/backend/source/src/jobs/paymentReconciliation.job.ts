import { logger } from '../config/logger';
import { reconcilePendingMongikePayments } from '../services/mongike-reconciliation.service';

export function startPaymentReconciliationJob(): void {
  // Run every 15 seconds using setInterval (cron minimum granularity is 1 minute).
  let running = false;
  setInterval(async () => {
    if (running) return; // skip if previous run is still in progress
    running = true;
    try {
      const resolved = await reconcilePendingMongikePayments();
      if (resolved > 0) {
        logger.info(`Payment reconciliation resolved ${resolved} pending payment(s)`);
      }
    } catch (err) {
      logger.error('Payment reconciliation job failed', { err });
    } finally {
      running = false;
    }
  }, 15_000);

  logger.info('Payment reconciliation job started (every 15 seconds)');
}