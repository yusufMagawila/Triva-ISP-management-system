-- Phase 4: AnyPay-only payment architecture.
--
-- - Removes Mongike/ZenoPayMobile provider columns and enum values.
-- - Renames payments.mongikeTxId -> providerTxId (generic provider reference).
-- - Adds AnyPay configuration fields (base URL override, enable toggle).
-- - Adds encrypted-credential columns that had previously only been applied
--   via `db push` so a fresh `migrate deploy` database is complete.
-- - Adds platform_settings: singleton row holding the platform's own AnyPay
--   credentials used for activation and subscription payments.
--
-- Every step is idempotent: databases built with `db push` may already have
-- the new columns/enum and lack the old ones.

-- ─── Tenants ────────────────────────────────────────────────────────────────

ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS "mongikApiKey",
  DROP COLUMN IF EXISTS "mongikApiKeyEnc",
  DROP COLUMN IF EXISTS "mongikWebhookToken",
  DROP COLUMN IF EXISTS "zenopayApiKey",
  DROP COLUMN IF EXISTS "zenopayApiKeyEnc",
  DROP COLUMN IF EXISTS "paymentProvider",
  ADD COLUMN IF NOT EXISTS "anypayApiKey" text,
  ADD COLUMN IF NOT EXISTS "anypayApiKeyEnc" text,
  ADD COLUMN IF NOT EXISTS "anypayBaseUrl" text,
  ADD COLUMN IF NOT EXISTS "anypayEnabled" boolean NOT NULL DEFAULT true;

-- ─── Encrypted credential columns previously applied via db push ────────────

ALTER TABLE public.routers        ADD COLUMN IF NOT EXISTS "passwordEnc" text;
ALTER TABLE public.tplink_routers ADD COLUMN IF NOT EXISTS "passwordEnc" text;
ALTER TABLE public.omada_sites    ADD COLUMN IF NOT EXISTS "radiusSecretEnc" text;

-- ─── Payments ───────────────────────────────────────────────────────────────

ALTER TABLE public.payments
  DROP COLUMN IF EXISTS "mongikRef",
  DROP COLUMN IF EXISTS "zenopayRef";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'mongikeTxId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'providerTxId'
  ) THEN
    ALTER TABLE public.payments RENAME COLUMN "mongikeTxId" TO "providerTxId";
  END IF;
END $$;

ALTER INDEX IF EXISTS "payments_mongikeTxId_key" RENAME TO "payments_providerTxId_key";
ALTER INDEX IF EXISTS "payments_mongikeTxId_idx" RENAME TO "payments_providerTxId_idx";

-- ─── PaymentProvider enum rebuild: VOUCHER/ANYPAY only ──────────────────────
-- PostgreSQL cannot drop enum values, so the type is rebuilt. Historical
-- MONGIKE/ZENOPAY_MOBILE rows are re-labelled ANYPAY: they are provider
-- attribution only and never drive runtime behaviour. Skipped entirely when
-- the enum already has the AnyPay-only shape (db-push databases).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."PaymentProvider" AS ENUM ('VOUCHER', 'ANYPAY');
  ELSIF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PaymentProvider' AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel IN ('MONGIKE', 'ZENOPAY_MOBILE')
  ) THEN
    ALTER TYPE public."PaymentProvider" RENAME TO "PaymentProvider_old";

    CREATE TYPE public."PaymentProvider" AS ENUM ('VOUCHER', 'ANYPAY');

    ALTER TABLE public.payments ALTER COLUMN provider DROP DEFAULT;

    ALTER TABLE public.payments
      ALTER COLUMN provider TYPE public."PaymentProvider"
      USING (
        CASE WHEN provider::text = 'VOUCHER'
             THEN 'VOUCHER'::public."PaymentProvider"
             ELSE 'ANYPAY'::public."PaymentProvider"
        END
      );

    ALTER TABLE public.payments
      ALTER COLUMN provider SET DEFAULT 'ANYPAY'::public."PaymentProvider";

    DROP TYPE public."PaymentProvider_old";
  END IF;
END $$;

-- ─── Platform settings (singleton) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_settings (
    id integer NOT NULL DEFAULT 1,
    "anypayKeyEnc" text,
    "anypayBaseUrl" text,
    "anypayEnabled" boolean DEFAULT false NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT platform_settings_pkey PRIMARY KEY (id)
);
