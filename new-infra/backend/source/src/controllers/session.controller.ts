import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { sessionService } from '../services/session.service';
import { AuthRequest } from '../types';

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) =>
      typeof currentValue === 'bigint' ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function listSessions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.tenantId as string | undefined)
      : req.user!.tenantId!;

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(status ? { status: status as 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED' } : {}),
    };

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where,
        include: { plan: true, router: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.session.count({ where }),
    ]);

    const jsonSafeSessions = toJsonSafe(sessions);

    res.json({
      success: true,
      data: jsonSafeSessions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const session = await prisma.session.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: req.user!.tenantId! } : {}),
      },
      include: { plan: true, router: { select: { id: true, name: true } }, payment: true },
    });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    res.json({ success: true, data: toJsonSafe(session) });
  } catch (err) {
    next(err);
  }
}

export async function disconnectSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const session = await prisma.session.findFirst({
      where: {
        id,
        ...(req.user!.role !== 'SUPER_ADMIN' ? { tenantId: req.user!.tenantId! } : {}),
      },
    });

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    await sessionService.disconnectSession(id);
    res.json({ success: true, message: 'Session disconnected' });
  } catch (err) {
    next(err);
  }
}
