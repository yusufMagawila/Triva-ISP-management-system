-- Add per-tenant webhook secret for provider callback authentication.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS "webhookSecret" text;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_webhookSecret_key"
  ON public.tenants("webhookSecret");
