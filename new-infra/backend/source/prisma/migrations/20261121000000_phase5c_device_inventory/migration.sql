-- Phase 5C: Unified device inventory + hardware test runs.
--
-- - Adds DeviceVendor / DeviceType / DeviceStatus /
--   DeviceProvisioningStatus / DeviceIdentitySource / HardwareTestResult
--   enums.
-- - Adds devices table — the canonical inventory/identity record that links
--   to the operational assets (routers / tplink_routers / omada_sites).
-- - Adds hardware_test_runs table — lab-mode evidence capture.
--
-- Every step is idempotent so databases that were partially migrated or
-- built via `db push` converge on the same shape.

-- ─── Enum creation ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceVendor') THEN
    CREATE TYPE "DeviceVendor" AS ENUM ('MIKROTIK','TPLINK','OMADA','UBNT','OPENWRT','OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceType') THEN
    CREATE TYPE "DeviceType" AS ENUM ('ROUTER','ACCESS_POINT','SWITCH','CONTROLLER','OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceStatus') THEN
    CREATE TYPE "DeviceStatus" AS ENUM ('UNASSIGNED','AVAILABLE','RESERVED','INSTALLING','ACTIVE','OFFLINE','FAULTY','RETIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceProvisioningStatus') THEN
    CREATE TYPE "DeviceProvisioningStatus" AS ENUM ('NOT_PROVISIONED','DISCOVERING','READY','CONFIGURING','VERIFYING','PROVISIONED','FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceIdentitySource') THEN
    CREATE TYPE "DeviceIdentitySource" AS ENUM ('SCAN','DISCOVERY','HEARTBEAT','MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HardwareTestResult') THEN
    CREATE TYPE "HardwareTestResult" AS ENUM ('PASS','FAIL','INFO','SKIP');
  END IF;
END $$;

-- ─── devices ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "devices" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "siteId"              TEXT,
  "vendor"              "DeviceVendor" NOT NULL,
  "deviceType"          "DeviceType" NOT NULL,
  "model"               TEXT,
  "serialNumber"        TEXT,
  "macAddress"          TEXT,
  "assetTag"            TEXT,
  "barcodeValue"        TEXT,
  "identitySource"      "DeviceIdentitySource" NOT NULL DEFAULT 'MANUAL',
  "status"              "DeviceStatus" NOT NULL DEFAULT 'UNASSIGNED',
  "provisioningStatus"  "DeviceProvisioningStatus" NOT NULL DEFAULT 'NOT_PROVISIONED',
  "routerId"            TEXT,
  "tpLinkRouterId"      TEXT,
  "omadaSiteId"         TEXT,
  "installedById"       TEXT,
  "installationId"      TEXT,
  "lastSeenAt"          TIMESTAMP(3),
  "installedAt"         TIMESTAMP(3),
  "retiredAt"           TIMESTAMP(3),
  "metadata"            JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "devices_serialNumber_key" ON "devices"("serialNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "devices_macAddress_key" ON "devices"("macAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "devices_barcodeValue_key" ON "devices"("barcodeValue");
CREATE UNIQUE INDEX IF NOT EXISTS "devices_routerId_key" ON "devices"("routerId");
CREATE UNIQUE INDEX IF NOT EXISTS "devices_tpLinkRouterId_key" ON "devices"("tpLinkRouterId");
CREATE UNIQUE INDEX IF NOT EXISTS "devices_omadaSiteId_key" ON "devices"("omadaSiteId");
CREATE INDEX IF NOT EXISTS "devices_tenantId_idx" ON "devices"("tenantId");
CREATE INDEX IF NOT EXISTS "devices_siteId_idx" ON "devices"("siteId");
CREATE INDEX IF NOT EXISTS "devices_status_idx" ON "devices"("status");

ALTER TABLE "devices" ADD CONSTRAINT "devices_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_routerId_fkey"
  FOREIGN KEY ("routerId") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_tpLinkRouterId_fkey"
  FOREIGN KEY ("tpLinkRouterId") REFERENCES "tplink_routers"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_omadaSiteId_fkey"
  FOREIGN KEY ("omadaSiteId") REFERENCES "omada_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_installedById_fkey"
  FOREIGN KEY ("installedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "devices" ADD CONSTRAINT "devices_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

-- ─── hardware_test_runs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "hardware_test_runs" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "siteId"         TEXT,
  "deviceId"       TEXT,
  "installationId" TEXT,
  "operatorId"     TEXT NOT NULL,
  "testName"       TEXT NOT NULL,
  "result"         "HardwareTestResult" NOT NULL,
  "durationMs"     INTEGER,
  "configVersion"  TEXT,
  "logs"           JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "hardware_test_runs_tenantId_createdAt_idx" ON "hardware_test_runs"("tenantId","createdAt");
CREATE INDEX IF NOT EXISTS "hardware_test_runs_deviceId_idx" ON "hardware_test_runs"("deviceId");

ALTER TABLE "hardware_test_runs" ADD CONSTRAINT "hardware_test_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "hardware_test_runs" ADD CONSTRAINT "hardware_test_runs_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "hardware_test_runs" ADD CONSTRAINT "hardware_test_runs_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;
