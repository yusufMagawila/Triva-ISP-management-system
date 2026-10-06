import { prisma } from '../config/prisma';
import { createMikroTikService } from './mikrotik.service';
import { getIO } from '../socket';
import { logger } from '../config/logger';

export class SubscriptionService {
  /**
   * Check all subscriptions and expire/disable routers as needed.
   * Run as a cron job.
   */
  async checkExpiredSubscriptions(): Promise<void> {
    const expired = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      include: { tenant: { include: { routers: true } } },
    });

    for (const sub of expired) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED' },
      });

      logger.info('Subscription expired for tenant', { tenantId: sub.tenantId });

      // Emit to dashboard
      const io = getIO();
      io.to(`tenant:${sub.tenantId}`).emit('subscription:expired', {
        tenantId: sub.tenantId,
        expiresAt: sub.expiresAt.toISOString(),
      });
    }

    logger.info(`Subscription check complete. Expired: ${expired.length}`);
  }

  /**
   * Renew or create a subscription for a tenant.
   */
  async renewSubscription(
    tenantId: string,
    plan: 'BASIC' | 'STANDARD' | 'PREMIUM',
    months = 1
  ) {
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });

    const now = new Date();
    const base = existing?.status === 'ACTIVE' && existing.expiresAt > now
      ? existing.expiresAt
      : now;

    const expiresAt = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    const updated = await prisma.subscription.upsert({
      where: { tenantId },
      update: { plan, status: 'ACTIVE', expiresAt },
      create: {
        tenantId,
        plan,
        status: 'ACTIVE',
        startsAt: now,
        expiresAt,
      },
    });

    logger.info('Subscription renewed', { tenantId, plan, expiresAt });
    return updated;
  }

  async getSubscriptionStatus(tenantId: string) {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) return null;

    const daysLeft = Math.max(
      0,
      Math.ceil((sub.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    );

    return { ...sub, daysLeft };
  }
}

export const subscriptionService = new SubscriptionService();
