import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AuthPayload, AuthRequest } from '../types';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

export function requireTenant(req: AuthRequest, res: Response, next: NextFunction): void {
  // Super admins can bypass tenant requirement (they specify tenantId via query param)
  if (req.user?.role === 'SUPER_ADMIN') {
    next();
    return;
  }
  if (!req.user?.tenantId) {
    res.status(403).json({ success: false, error: 'No tenant associated with this account' });
    return;
  }
  next();
}

export async function validateTenantAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // Super admins can access any tenant
  if (req.user.role === 'SUPER_ADMIN') {
    next();
    return;
  }

  const tenantId = req.params.tenantId || req.user.tenantId;

  if (!tenantId || tenantId !== req.user.tenantId) {
    res.status(403).json({ success: false, error: 'Access denied to this tenant' });
    return;
  }

  // Check tenant subscription is active
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { subscription: true },
  });

  if (!tenant || tenant.status !== 'ACTIVE') {
    res.status(403).json({ success: false, error: 'Tenant account is suspended or not found' });
    return;
  }

  if (
    tenant.subscription &&
    tenant.subscription.status === 'EXPIRED' &&
    new Date() > tenant.subscription.expiresAt
  ) {
    res.status(402).json({
      success: false,
      error: 'Subscription expired. Please renew to continue.',
    });
    return;
  }

  next();
}
