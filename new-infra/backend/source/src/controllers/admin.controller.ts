import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { subscriptionService } from '../services/subscription.service';
import { AuthRequest } from '../types';

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
