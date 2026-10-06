import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { encryptTenantKey, generateWebhookSecret } from '../lib/crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AuthRequest, AuthPayload } from '../types';
import { Request } from 'express';
import { MongikeService } from '../services/mongike.service';
import { reconcileMongikeOrder } from '../services/mongike-reconciliation.service';

const ACTIVATION_FEE_TZS = 35_000;

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { shopName, email, phone, merchantName, password } = req.body as {
      shopName: string;
      email: string;
      phone?: string;
      merchantName: string;
      password: string;
    };

    // Check email not already taken
    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (exists) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    const slug = shopName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Ensure slug is unique
    const slugExists = await prisma.tenant.findUnique({ where: { slug } });
    if (slugExists) {
      res.status(409).json({ success: false, error: 'A shop with a similar name already exists. Please choose a different name.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Tenant starts PENDING — only goes ACTIVE after 35,000 TZS activation payment
    const tenant = await prisma.tenant.create({
      data: {
        name: shopName,
        slug,
        email: email.toLowerCase().trim(),
        phone,
        status: 'PENDING',
        webhookSecret: generateWebhookSecret(),
        users: {
          create: {
            email: email.toLowerCase().trim(),
            passwordHash,
            name: merchantName,
            role: 'MERCHANT',
          },
        },
      },
    });

    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
    if (!user) throw new Error('User creation failed');

    const payload: AuthPayload = {
      userId: user.id,
      tenantId: tenant.id,
      role: 'MERCHANT',
      email: user.email,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });

    res.status(201).json({
      success: true,
      data: {
        token,
        activationRequired: true,
        activationFee: ACTIVATION_FEE_TZS,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: tenant.id,
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: 'PENDING', subscription: null },
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/activate-payment
 * Merchant pays the one-time 35,000 TZS activation fee.
 * Uses the PLATFORM Mongike key (activation money goes to platform, not merchant).
 */
export async function initiateActivationPayment(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { phone } = req.body as { phone: string };

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    if (tenant.status === 'ACTIVE') {
      res.status(400).json({ success: false, error: 'Account is already active' });
      return;
    }

    // Check no pending activation payment already
    const existing = await prisma.payment.findFirst({
      where: { tenantId, mongikeTxId: { startsWith: 'act_' }, status: 'PENDING' },
    });
    if (existing) {
      res.status(400).json({ success: false, error: 'Activation payment already pending. Check your phone.' });
      return;
    }

    const orderId = `act_${tenantId}_${Date.now()}`;
    const webhookUrl = `${env.APP_URL}/api/auth/activation-webhook/${env.ACTIVATION_WEBHOOK_SECRET}`;

    // Platform key — activation fee comes to the platform
    const svc = new MongikeService();
    await svc.initiatePayment({
      orderId,
      amount: ACTIVATION_FEE_TZS,
      buyerPhone: phone.replace(/^\+/, ''),
      webhookUrl,
    });

    await prisma.payment.create({
      data: {
        tenantId,
        amount: ACTIVATION_FEE_TZS,
        currency: 'TZS',
        phone,
        status: 'PENDING',
        mongikeTxId: orderId,
      },
    });

    res.json({
      success: true,
      data: {
        orderId,
        amount: ACTIVATION_FEE_TZS,
        message: 'Check your phone for the payment prompt',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/activation-webhook  (Mongike webhook)
 * Confirms the 35,000 TZS activation fee and activates the tenant account.
 */
export async function handleActivationWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { order_id, status, transaction_id } = req.body as {
      order_id: string;
      status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      transaction_id?: string;
    };

    if (!order_id) {
      res.status(400).json({ success: false, error: 'Missing order_id' });
      return;
    }

    if (!order_id.startsWith('act_')) {
      res.status(200).json({ received: true });
      return;
    }

    await reconcileMongikeOrder(order_id, { status, transaction_id });

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: { include: { subscription: true } } },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: AuthPayload = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          tenant: user.tenant
            ? {
                id: user.tenant.id,
                name: user.tenant.name,
                slug: user.tenant.slug,
                subscription: user.tenant.subscription,
              }
            : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { tenant: { include: { subscription: true } } },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashed } });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const { mongikApiKey, logoUrl } = req.body as {
      mongikApiKey?: string;
      logoUrl?: string;
    };

    const data: Record<string, string | undefined | null> = {};
    if (mongikApiKey !== undefined) {
      // Encrypt in place; clear legacy plaintext field.
      data.mongikApiKeyEnc = mongikApiKey ? encryptTenantKey(mongikApiKey) : null;
      data.mongikApiKey = mongikApiKey ? undefined : null;
    }
    if (logoUrl !== undefined) data.logoUrl = logoUrl || undefined;

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: {
        id: true,
        name: true,
        logoUrl: true,
        // Return masked API key — never return full key
        mongikApiKey: true,
        mongikApiKeyEnc: true,
      },
    });

    const keySet = !!(tenant.mongikApiKeyEnc || tenant.mongikApiKey);

    // Mask sensitive values in response
    res.json({
      success: true,
      data: {
        ...tenant,
        mongikApiKey: keySet ? '********' : null,
        mongikApiKeySet: keySet,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        logoUrl: true,
        mongikApiKey: true,
        mongikApiKeyEnc: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const keySet = !!(tenant.mongikApiKeyEnc || tenant.mongikApiKey);

    res.json({
      success: true,
      data: {
        ...tenant,
        mongikApiKey: keySet ? '********' : null,
        mongikApiKeySet: keySet,
      },
    });
  } catch (err) {
    next(err);
  }
}
