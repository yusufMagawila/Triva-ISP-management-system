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

/**
 * Dashboard routes are for tenant staff (MERCHANT) and platform admins.
 * INSTALLER accounts authenticate fine but must live inside the scoped
 * /api/install namespace — they get no tenant-wide dashboard privileges.
 */
export function requireDashboardRole(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (req.user.role === 'INSTALLER' || req.user.scope === 'install') {
    res.status(403).json({ success: false, error: 'Installer accounts use the /api/install namespace' });
    return;
  }
  next();
}

/**
 * Scoped-token enforcement for the /api/install namespace. Login JWTs pass
 * through untouched; tokens with scope='install' are verified against the
 * InstallerToken table so revoked/expired credentials die here.
 */
export async function verifyInstallScope(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.scope !== 'install') {
    next();
    return;
  }
  try {
    const { verifyScopedToken } = await import('../services/installer-token.service');
    const result = await verifyScopedToken(req.user as Parameters<typeof verifyScopedToken>[0]);
    if (!result.ok) {
      res.status(401).json({ success: false, error: `Scoped token invalid: ${result.reason}` });
      return;
    }
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Scoped token verification failed' });
  }
}

export async function resolveInstallationContext(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, error: 'Unauthorized' });
    if (req.user.role === 'INSTALLER') {
      const actor = await prisma.user.findUnique({ where: { id: req.user.userId } });
      if (!actor?.isActive || actor.role !== 'INSTALLER') {
        return void res.status(403).json({ success: false, error: 'Installer account is disabled' });
      }
    }
    req.body ??= {};
    const routeId = req.path.match(/^\/installations\/([^/]+)/)?.[1];
    const headerId = req.get('x-installation-id');
    if (routeId && headerId && routeId !== headerId) {
      return void res.status(403).json({ success: false, error: 'Installation context mismatch' });
    }
    const id = routeId ?? headerId ?? (req.path.startsWith('/devices') ? req.user.installationId : undefined);
    if (!id) {
      if (req.user.role === 'INSTALLER' && req.path.startsWith('/devices')) return void res.status(403).json({ success: false, error: 'Open an assigned installation before scanning a device' });
      return next();
    }
    const job = await prisma.installation.findUnique({ where: { id } });
    const user = req.user;
    if (!job || (user.role === 'INSTALLER' ? job.installerId !== user.userId : user.role !== 'SUPER_ADMIN' && job.tenantId !== user.tenantId)
      || (user.scope === 'install' && (user.tenantId !== job.tenantId || (user.installationId && user.installationId !== id) || (user.siteId && user.siteId !== job.siteId)))) {
      return void res.status(403).json({ success: false, error: 'Installation is not assigned to you' });
    }
    if (headerId && !routeId && !req.path.startsWith('/devices')) {
      return void res.status(403).json({ success: false, error: 'Use installation-scoped endpoints' });
    }
    if (req.path.startsWith('/devices')) {
      if ((req.body.siteId && req.body.siteId !== job.siteId) || (req.body.installationId && req.body.installationId !== id)) {
        return void res.status(403).json({ success: false, error: 'Device must belong to this installation site' });
      }
      const deviceId = req.path.match(/^\/devices\/([^/]+)/)?.[1];
      if (deviceId && !['identify', 'register'].includes(deviceId)) {
        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device || device.tenantId !== job.tenantId || (device.siteId && device.siteId !== job.siteId)) {
          return void res.status(403).json({ success: false, error: 'Device is not available to this installation' });
        }
      }
      req.query.siteId = job.siteId;
      if (req.path === '/devices/register') req.body.siteId = job.siteId;
    }
    if (user.role === 'INSTALLER' || user.scope === 'install') {
      req.user = { ...user, tenantId: job.tenantId, scope: 'install', installationId: job.id, siteId: job.siteId };
    } else {
      req.query.tenantId = job.tenantId;
      if (req.body.tenantId) req.body.tenantId = job.tenantId;
    }
    next();
  } catch (err) {
    next(err);
  }
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
