-- Portal themes: merchant-selectable look + seasonal mode.
-- Idempotent so partially migrated databases converge on the same shape.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "portalTheme" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "portalSeasonal" TEXT NOT NULL DEFAULT 'auto';
