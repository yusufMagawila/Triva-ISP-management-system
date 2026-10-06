import { Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AuthRequest } from '../types';
import { VoucherStatus } from '@prisma/client';

// Generate a voucher code in the format TRIVA-XXXXX (5 uppercase alphanumeric chars)
function generateVoucherCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 to avoid confusion
  const bytes = randomBytes(5);
  const code = Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
  return `TRIVA-${code}`;
}

/**
 * POST /api/vouchers
 * Create a batch of voucher codes for a plan.
 * Body: { planId, quantity (1-100), expiresAt? (ISO date string) }
 */
export async function createVoucherBatch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { planId, quantity, expiresAt } = req.body as {
      planId: string;
      quantity: number | string;
      expiresAt?: string;
    };

    const qty = parseInt(String(quantity), 10);
    if (!planId || isNaN(qty) || qty < 1 || qty > 100) {
      res.status(400).json({
        success: false,
        error: 'planId is required and quantity must be between 1 and 100',
      });
      return;
    }

    // Ensure plan belongs to this tenant
    const plan = await prisma.plan.findFirst({ where: { id: planId, tenantId, status: 'ACTIVE' } });
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    const parsedExpiresAt = expiresAt ? new Date(expiresAt) : undefined;
    if (parsedExpiresAt && isNaN(parsedExpiresAt.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid expiresAt date' });
      return;
    }

    // Generate unique codes (retry if collision)
    const codes: string[] = [];
    const maxAttempts = qty * 5;
    let attempts = 0;
    while (codes.length < qty && attempts < maxAttempts) {
      const code = generateVoucherCode();
      if (!codes.includes(code)) {
        const existing = await prisma.voucher.findUnique({ where: { code } });
        if (!existing) {
          codes.push(code);
        }
      }
      attempts++;
    }

    if (codes.length < qty) {
      res.status(500).json({
        success: false,
        error: 'Could not generate enough unique codes, please try again',
      });
      return;
    }

    await prisma.voucher.createMany({
      data: codes.map((code) => ({
        code,
        tenantId,
        planId,
        status: 'ACTIVE' as VoucherStatus,
        expiresAt: parsedExpiresAt ?? null,
      })),
    });

    // Return the created vouchers with plan info
    const vouchers = await prisma.voucher.findMany({
      where: { code: { in: codes } },
      include: { plan: { select: { id: true, name: true, durationMins: true, price: true } } },
      orderBy: { createdAt: 'asc' },
    });

    logger.info('Voucher batch created', { tenantId, planId, qty });
    res.status(201).json({ success: true, data: vouchers });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/vouchers
 * List vouchers for the tenant with pagination and optional status filter.
 */
export async function listVouchers(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId =
      req.user!.role === 'SUPER_ADMIN'
        ? ((req.query.tenantId as string | undefined) ?? req.user!.tenantId!)
        : req.user!.tenantId!;

    const status = req.query.status as VoucherStatus | undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));

    const where = {
      tenantId,
      ...(status ? { status } : {}),
    };

    const [vouchers, total, stats] = await Promise.all([
      prisma.voucher.findMany({
        where,
        include: {
          plan: { select: { id: true, name: true, durationMins: true, price: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.voucher.count({ where }),
      prisma.voucher.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
    ]);

    const statsCounts: Record<string, number> = { ACTIVE: 0, REDEEMED: 0, EXPIRED: 0, CANCELLED: 0 };
    for (const row of stats) {
      statsCounts[row.status] = row._count._all;
    }

    res.json({
      success: true,
      data: vouchers,
      stats: statsCounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/vouchers/:id
 * Cancel an ACTIVE voucher. Cannot cancel already-redeemed vouchers.
 */
export async function cancelVoucher(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { id } = req.params;

    const voucher = await prisma.voucher.findFirst({ where: { id, tenantId } });

    if (!voucher) {
      res.status(404).json({ success: false, error: 'Voucher not found' });
      return;
    }

    if (voucher.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        error: `Cannot cancel a voucher with status: ${voucher.status}`,
      });
      return;
    }

    await prisma.voucher.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    res.json({ success: true, message: 'Voucher cancelled' });
  } catch (err) {
    next(err);
  }
}
