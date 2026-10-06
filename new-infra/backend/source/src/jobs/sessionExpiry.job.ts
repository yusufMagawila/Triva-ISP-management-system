import cron from 'node-cron';
import { prisma } from '../config/prisma';
import { sessionService } from '../services/session.service';
import { logger } from '../config/logger';

/**
 * Runs every minute: find expired sessions and clean them up.
 */
export function startSessionExpiryJob(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const expiredSessions = await prisma.session.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() },
        },
        select: { id: true },
      });

      if (expiredSessions.length === 0) return;

      logger.info(`Session expiry job: expiring ${expiredSessions.length} sessions`);

      await Promise.allSettled(
        expiredSessions.map((s) => sessionService.expireSession(s.id))
      );
    } catch (err) {
      logger.error('Session expiry job failed', { err });
    }
  });

  logger.info('Session expiry cron job started (every minute)');
}

/**
 * Runs every hour: clean up stale PENDING sessions older than 30 minutes.
 */
export function startStalePendingCleanupJob(): void {
  cron.schedule('0 * * * *', async () => {
    try {
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);

      const result = await prisma.session.updateMany({
        where: {
          status: 'PENDING',
          createdAt: { lt: staleThreshold },
        },
        data: { status: 'EXPIRED' },
      });

      if (result.count > 0) {
        logger.info(`Stale pending cleanup: expired ${result.count} pending sessions`);
      }
    } catch (err) {
      logger.error('Stale pending cleanup job failed', { err });
    }
  });

  logger.info('Stale pending session cleanup cron job started (every hour)');
}
