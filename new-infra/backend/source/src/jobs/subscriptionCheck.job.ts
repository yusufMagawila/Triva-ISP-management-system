import cron from 'node-cron';
import { subscriptionService } from '../services/subscription.service';
import { logger } from '../config/logger';

/**
 * Runs every 6 hours: check subscriptions and mark expired ones.
 */
export function startSubscriptionCheckJob(): void {
  cron.schedule('0 */6 * * *', async () => {
    try {
      await subscriptionService.checkExpiredSubscriptions();
    } catch (err) {
      logger.error('Subscription check job failed', { err });
    }
  });

  logger.info('Subscription check cron job started (every 6 hours)');
}

/**
 * Runs every day at midnight: ping all routers and update status.
 */
export function startRouterHealthCheckJob(): void {
  cron.schedule('0 0 * * *', async () => {
    logger.info('Router health check job running...');
    // Health checks are done on-demand via ping endpoint
    // This job is a placeholder for future batch health checks
  });
}
