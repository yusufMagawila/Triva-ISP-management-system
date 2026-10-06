import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';

export async function listPlans(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const plans = await prisma.plan.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(req.query.status ? { status: req.query.status as 'ACTIVE' | 'INACTIVE' } : {}),
      },
      orderBy: { price: 'asc' },
    });

    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
}

export async function createPlan(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { name, description, price, durationMins, downloadKbps, uploadKbps, dataLimitMb } =
      req.body as {
        name: string;
        description?: string;
        price: number;
        durationMins: number;
        downloadKbps?: number;
        uploadKbps?: number;
        dataLimitMb?: number;
      };

    const plan = await prisma.plan.create({
      data: {
        tenantId,
        name,
        description,
        price,
        durationMins,
        downloadKbps,
        uploadKbps,
        dataLimitMb,
      },
    });

    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

export async function updatePlan(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const plan = await prisma.plan.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    const updated = await prisma.plan.update({
      where: { id },
      data: req.body as object,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

export async function deletePlan(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const plan = await prisma.plan.findFirst({
      where: { id, tenantId: req.user!.tenantId! },
    });

    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    // Soft delete
    await prisma.plan.update({ where: { id }, data: { status: 'INACTIVE' } });
    res.json({ success: true, message: 'Plan deactivated' });
  } catch (err) {
    next(err);
  }
}
