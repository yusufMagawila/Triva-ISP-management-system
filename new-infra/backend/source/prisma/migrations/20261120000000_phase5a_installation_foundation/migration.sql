-- Phase 5A: Installation foundation.
--
-- - Adds INSTALLER to UserRole (scoped installation identity).
-- - Adds Customer / Site / Installation / InstallerToken /
--   InstallationSecret / AuditLog tables.
-- - Links devices to sites (routers.site_id, tplink_routers.site_id,
--   omada_sites.site_id).
-- - Adds RouterOS discovery columns to routers (model, routerOsVersion,
--   discovery snapshot, discoveredAt).
--
-- Every step is idempotent so databases that were partially migrated or
-- built via `db push` converge on the same shape.

-- ─── Enum additions ─────────────────────────────────────────────────────────

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INSTALLER';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerStatus') THEN
    CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SiteStatus') THEN
    CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SiteInstallationStatus') THEN
    CREATE TYPE "SiteInstallationStatus" AS ENUM ('UNINSTALLED', 'IN_PROGRESS', 'ONLINE', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InstallationStatus') THEN
    CREATE TYPE "InstallationStatus" AS ENUM
      ('DRAFT', 'IN_PROGRESS', 'WAITING_FOR_HARDWARE', 'CONFIGURING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InstallationStage') THEN
    CREATE TYPE "InstallationStage" AS ENUM
      ('CUSTOMER', 'SITE', 'HARDWARE', 'WAN', 'LAN', 'WIFI', 'CAPTIVE_PORTAL', 'BILLING', 'SECURITY', 'VERIFICATION', 'COMPLETION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditResult') THEN
    CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');
  END IF;
END $$;

-- ─── Device ↔ Site links and RouterOS discovery columns ─────────────────────

ALTER TABLE public.routers
  ADD COLUMN IF NOT EXISTS "siteId" text,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "routerOsVersion" text,
  ADD COLUMN IF NOT EXISTS "discovery" jsonb,
  ADD COLUMN IF NOT EXISTS "discoveredAt" timestamp(3);

ALTER TABLE public.tplink_routers ADD COLUMN IF NOT EXISTS "siteId" text;
ALTER TABLE public.omada_sites    ADD COLUMN IF NOT EXISTS "siteId" text;

-- ─── Customers ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customers (
  "id"          text PRIMARY KEY,
  "tenantId"    text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "name"        text NOT NULL,
  "contactName" text,
  "phone"       text,
  "email"       text,
  "status"      "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata"    jsonb,
  "createdAt"   timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customers_tenantId_idx" ON public.customers("tenantId");

-- ─── Sites ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sites (
  "id"                 text PRIMARY KEY,
  "tenantId"           text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "customerId"         text REFERENCES public.customers(id) ON DELETE SET NULL,
  "name"               text NOT NULL,
  "address"            text,
  "location"           text,
  "status"             "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
  "installationStatus" "SiteInstallationStatus" NOT NULL DEFAULT 'UNINSTALLED',
  "metadata"           jsonb,
  "createdAt"          timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"          timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sites_tenantId_idx"  ON public.sites("tenantId");
CREATE INDEX IF NOT EXISTS "sites_customerId_idx" ON public.sites("customerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routers_siteId_fkey') THEN
    ALTER TABLE public.routers
      ADD CONSTRAINT "routers_siteId_fkey" FOREIGN KEY ("siteId")
      REFERENCES public.sites(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tplink_routers_siteId_fkey') THEN
    ALTER TABLE public.tplink_routers
      ADD CONSTRAINT "tplink_routers_siteId_fkey" FOREIGN KEY ("siteId")
      REFERENCES public.sites(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'omada_sites_siteId_fkey') THEN
    ALTER TABLE public.omada_sites
      ADD CONSTRAINT "omada_sites_siteId_fkey" FOREIGN KEY ("siteId")
      REFERENCES public.sites(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "routers_siteId_idx"        ON public.routers("siteId");
CREATE INDEX IF NOT EXISTS "tplink_routers_siteId_idx" ON public.tplink_routers("siteId");
CREATE INDEX IF NOT EXISTS "omada_sites_siteId_idx"    ON public.omada_sites("siteId");

-- ─── Installations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.installations (
  "id"               text PRIMARY KEY,
  "tenantId"         text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "siteId"           text NOT NULL REFERENCES public.sites(id),
  "installerId"      text NOT NULL REFERENCES public.users(id),
  "status"           "InstallationStatus" NOT NULL DEFAULT 'DRAFT',
  "stage"            "InstallationStage" NOT NULL DEFAULT 'CUSTOMER',
  "failureReason"    text,
  "contractVersion"  text NOT NULL DEFAULT '1.0',
  "revision"         integer NOT NULL DEFAULT 0,
  "idempotencyKey"   text UNIQUE,
  "requestedConfig"  jsonb,
  "validatedConfig"  jsonb,
  "executedConfig"   jsonb,
  "executionResults" jsonb,
  "approvals"        jsonb,
  "startedAt"        timestamp(3) NOT NULL DEFAULT now(),
  "completedAt"      timestamp(3),
  "metadata"         jsonb,
  "createdAt"        timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"        timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "installations_tenantId_idx"    ON public.installations("tenantId");
CREATE INDEX IF NOT EXISTS "installations_siteId_idx"      ON public.installations("siteId");
CREATE INDEX IF NOT EXISTS "installations_installerId_idx" ON public.installations("installerId");
CREATE INDEX IF NOT EXISTS "installations_status_idx"      ON public.installations("status");

-- ─── Installer tokens ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.installer_tokens (
  "id"             text PRIMARY KEY,
  "jti"            text UNIQUE NOT NULL,
  "installerId"    text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "tenantId"       text NOT NULL,
  "installationId" text REFERENCES public.installations(id) ON DELETE SET NULL,
  "siteId"         text,
  "scopes"         text[] NOT NULL DEFAULT '{}',
  "expiresAt"      timestamp(3) NOT NULL,
  "revokedAt"      timestamp(3),
  "createdAt"      timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "installer_tokens_installerId_idx" ON public.installer_tokens("installerId");
CREATE INDEX IF NOT EXISTS "installer_tokens_tenantId_idx"    ON public.installer_tokens("tenantId");

-- ─── Installation secrets ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.installation_secrets (
  "id"             text PRIMARY KEY,
  "installationId" text NOT NULL REFERENCES public.installations(id) ON DELETE CASCADE,
  "kind"           text NOT NULL,
  "label"          text,
  "valueEnc"       text NOT NULL,
  "consumedAt"     timestamp(3),
  "createdAt"      timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "installation_secrets_installationId_idx"
  ON public.installation_secrets("installationId");

-- ─── Audit logs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  "id"             text PRIMARY KEY,
  "tenantId"       text,
  "userId"         text,
  "installationId" text,
  "siteId"         text,
  "action"         text NOT NULL,
  "targetType"     text,
  "targetId"       text,
  "result"         "AuditResult" NOT NULL DEFAULT 'SUCCESS',
  "correlationId"  text,
  "metadata"       jsonb,
  "createdAt"      timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_createdAt_idx" ON public.audit_logs("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_installationId_idx"     ON public.audit_logs("installationId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"             ON public.audit_logs("action");
