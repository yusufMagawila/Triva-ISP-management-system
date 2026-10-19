import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { subscriptionService } from '../services/subscription.service';
import {
  getPlatformPaymentConfigView,
  updatePlatformPaymentConfig,
  getPlatformGateway,
} from '../services/platform-settings.service';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { recordAudit } from '../services/audit.service';

export async function getDashboardStats(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const [tenants, users, activeSessions, todayPayments] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.session.count({ where: { status: 'ACTIVE' } }),
      prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _sum: { amount: true },
      }),
    ]);

    const expiringSoon = await prisma.subscription.count({
      where: {
        status: 'ACTIVE',
        expiresAt: {
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          gt: new Date(),
        },
      },
    });

    res.json({
      success: true,
      data: {
        totalTenants: tenants,
        totalUsers: users,
        activeSessions,
        todayRevenue: todayPayments._sum.amount ?? 0,
        subscriptionsExpiringSoon: expiringSoon,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listTenants(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        include: {
          subscription: true,
          _count: { select: { routers: true, sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.tenant.count(),
    ]);

    res.json({
      success: true,
      data: tenants,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function createTenant(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      name,
      slug,
      email,
      phone,
      address,
      merchantName,
      merchantEmail,
      merchantPassword,
      subscriptionPlan,
    } = req.body as {
      name: string;
      slug: string;
      email: string;
      phone?: string;
      address?: string;
      merchantName: string;
      merchantEmail: string;
      merchantPassword: string;
      subscriptionPlan?: 'BASIC' | 'STANDARD' | 'PREMIUM';
    };

    const passwordHash = await bcrypt.hash(merchantPassword, 12);

    // Admin-created tenants start ACTIVE immediately with a subscription (admin manages activation manually)
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug: slug.toLowerCase().replace(/\s+/g, '-'),
        email,
        phone,
        address,
        status: 'ACTIVE',
        subscription: {
          create: {
            plan: subscriptionPlan ?? 'BASIC',
            status: 'ACTIVE',
            startsAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          },
        },
        users: {
          create: {
            email: merchantEmail,
            passwordHash,
            name: merchantName,
            role: 'MERCHANT',
          },
        },
      },
      include: { subscription: true },
    });

    res.status(201).json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function updateTenantStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: 'ACTIVE' | 'SUSPENDED' };

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { status },
    });

    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

/**
 * SUPER_ADMIN: set a new password for a tenant's merchant account (default:
 * the oldest MERCHANT user) or for a specific user inside that tenant.
 * The password is never logged or audited.
 */
export async function resetTenantPassword(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { newPassword, userId } = req.body as { newPassword?: string; userId?: string };

    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ success: false, error: 'newPassword must be 8-128 characters' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const user = userId
      ? await prisma.user.findFirst({ where: { id: userId, tenantId: tenant.id }, select: { id: true, email: true } })
      : await prisma.user.findFirst({
          where: { tenantId: tenant.id, role: 'MERCHANT' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, email: true },
        });
    if (!user) {
      res.status(404).json({ success: false, error: 'No matching user found for this tenant' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });

    await recordAudit({
      tenantId: tenant.id,
      userId: req.user!.userId,
      action: 'TENANT_PASSWORD_RESET',
      targetType: 'user',
      targetId: user.id,
    });

    res.json({ success: true, data: { tenantId: tenant.id, userId: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
}

export async function renewTenantSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { plan, months } = req.body as { plan: 'BASIC' | 'STANDARD' | 'PREMIUM'; months?: number };

    const updated = await subscriptionService.renewSubscription(id, plan, months ?? 1);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/payment-config
 * Platform-level AnyPay configuration (collects activation + subscription
 * fees). Secrets are masked — plaintext is never returned.
 */
export async function getPlatformPaymentConfig(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.json({ success: true, data: await getPlatformPaymentConfigView() });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/payment-config
 * Updates the platform AnyPay configuration. Empty secret fields are left
 * unchanged.
 */
export async function updatePlatformPaymentConfigHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { apiKey, accessToken, baseUrl, enabled } = req.body as {
      apiKey?: string;
      accessToken?: string;
      baseUrl?: string;
      enabled?: boolean;
    };

    if (baseUrl !== undefined && baseUrl.trim()) {
      try {
        const parsed = new URL(baseUrl.trim());
        if (parsed.protocol !== 'https:') {
          res.status(400).json({ success: false, error: 'Base URL must use https://' });
          return;
        }
      } catch {
        res.status(400).json({ success: false, error: 'Base URL must be a valid URL' });
        return;
      }
    }

    await updatePlatformPaymentConfig({ apiKey, accessToken, baseUrl, enabled });
    logger.info('Platform payment config updated', { adminUserId: req.user!.userId });

    res.json({
      success: true,
      message: 'Platform payment configuration saved.',
      data: await getPlatformPaymentConfigView(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/payment-config/test
 * Verifies the platform AnyPay credentials with a lightweight status call.
 */
export async function testPlatformPaymentConfig(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const gateway = await getPlatformGateway();
    if (!gateway) {
      res.status(400).json({ success: false, error: 'Platform AnyPay is not configured or is disabled' });
      return;
    }
    const result = await gateway.getTransactionStatus('TEST_PING_' + Date.now());
    const reachable = result !== null;
    res.json({
      success: reachable,
      message: reachable
        ? 'Platform AnyPay connection test completed.'
        : 'Could not reach AnyPay — check the credentials and base URL.',
    });
  } catch (err) {
    next(err);
  }
}
