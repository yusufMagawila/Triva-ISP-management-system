/**
 * Audit service — append-only record of sensitive installation actions.
 *
 * metadata is run through sanitizeSecrets() before persisting; callers must
 * still avoid handing raw secrets in (defense in depth, not the only line).
 */

import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { sanitizeSecrets } from '../lib/sanitize';

export type AuditAction =
  | 'INSTALLATION_CREATED'
  | 'INSTALLATION_UPDATED'
  | 'INSTALLATION_STATUS_CHANGED'
  | 'INSTALLATION_COMPLETED'
  | 'INSTALLATION_CANCELLED'
  | 'CUSTOMER_CREATED'
  | 'SITE_CREATED'
  | 'DEVICE_SCANNED'
  | 'DEVICE_DISCOVERED'
  | 'DEVICE_CLAIMED'
  | 'DEVICE_CLAIM_DENIED'
  | 'CONFIGURATION_REQUESTED'
  | 'CONFIGURATION_VALIDATED'
  | 'CONFIGURATION_REJECTED'
  | 'ACTION_REQUESTED'
  | 'CONFIGURATION_EXECUTED'
  | 'CONFIGURATION_FAILED'
  | 'ACTION_DENIED'
  | 'DIAGNOSTIC_STARTED'
  | 'DIAGNOSTIC_FAILED'
  | 'SECRET_CREATED'
  | 'SECRET_CONSUMED'
  | 'INSTALLER_TOKEN_ISSUED'
  | 'INSTALLER_TOKEN_REVOKED'
  | 'INSTALLER_CREATED'
  | 'INSTALLER_AUTH_DENIED'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_ASSIGNED'
  | 'DEVICE_REASSIGNED'
  | 'DEVICE_IDENTIFIED'
  | 'AI_PLAN_GENERATED'
  | 'AI_PLAN_REJECTED'
  | 'AI_DIAGNOSTIC_GENERATED'
  | 'HARDWARE_TEST_RECORDED';

export interface AuditEntry {
  tenantId?: string | null;
  userId?: string | null;
  installationId?: string | null;
  siteId?: string | null;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  correlationId?: string;
  metadata?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        userId: entry.userId ?? null,
        installationId: entry.installationId ?? null,
        siteId: entry.siteId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        result: entry.result ?? 'SUCCESS',
        correlationId: entry.correlationId ?? null,
        metadata: entry.metadata === undefined ? undefined : (sanitizeSecrets(entry.metadata) as object),
      },
    });
  } catch (err) {
    // Auditing must never break the operation being audited.
    logger.error('Failed to write audit log', { action: entry.action, err });
  }
}
