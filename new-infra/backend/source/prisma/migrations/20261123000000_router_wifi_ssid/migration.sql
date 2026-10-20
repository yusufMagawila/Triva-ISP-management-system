-- Desired WiFi name per router, applied by the router's own pull-sync.
-- Idempotent so partially migrated databases converge on the same shape.

ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "wifiSsid" TEXT;
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "wifiSsidApplied" TEXT;
