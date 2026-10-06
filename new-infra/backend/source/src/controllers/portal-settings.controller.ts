import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../types';

const DEFAULT_NOTICE_COLOR = '#2563eb';

function normalizeNoticeColor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    throw Object.assign(new Error('Portal notice color must be a valid hex color'), {
      statusCode: 400,
    });
  }

  return trimmed.length === 4
    ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase()
    : trimmed.toLowerCase();
}

export async function getPortalSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Tenant context is required' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        portalNoticeName: true,
        portalNoticeMessage: true,
        portalNoticeColor: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        portalNoticeName: tenant.portalNoticeName,
        portalNoticeMessage: tenant.portalNoticeMessage,
        portalNoticeColor: tenant.portalNoticeColor ?? DEFAULT_NOTICE_COLOR,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updatePortalSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(400).json({ success: false, error: 'Tenant context is required' });
      return;
    }

    const body = req.body as {
      portalNoticeName?: string;
      portalNoticeMessage?: string;
      portalNoticeColor?: string;
    };

    const updateData: Record<string, unknown> = {};

    if (body.portalNoticeName !== undefined) {
      const trimmed = body.portalNoticeName.trim();
      if (trimmed.length > 60) {
        res
          .status(400)
          .json({ success: false, error: 'Portal notice name must be 60 characters or less' });
        return;
      }
      updateData.portalNoticeName = trimmed || null;
    }

    if (body.portalNoticeMessage !== undefined) {
      const trimmed = body.portalNoticeMessage.trim();
      if (trimmed.length > 280) {
        res
          .status(400)
          .json({ success: false, error: 'Portal notice message must be 280 characters or less' });
        return;
      }
      updateData.portalNoticeMessage = trimmed || null;
    }

    if (body.portalNoticeColor !== undefined) {
      updateData.portalNoticeColor =
        normalizeNoticeColor(body.portalNoticeColor) ?? DEFAULT_NOTICE_COLOR;
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
      select: {
        portalNoticeName: true,
        portalNoticeMessage: true,
        portalNoticeColor: true,
      },
    });

    res.json({
      success: true,
      message: 'Portal notice updated successfully.',
      data: {
        portalNoticeName: updated.portalNoticeName,
        portalNoticeMessage: updated.portalNoticeMessage,
        portalNoticeColor: updated.portalNoticeColor ?? DEFAULT_NOTICE_COLOR,
      },
    });
  } catch (err) {
    next(err);
  }
}
