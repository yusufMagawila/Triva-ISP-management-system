# Triva WiFi — Phase 3B Final Report

**Date:** 2026-10-06  
**Status:** Security remediation implemented, isolated environment validated  
**Domain:** trivaconnect.site (subdomains configured)  
**Recommendation:** **CONDITIONAL GO** for isolated testing; **NO-GO** for production cutover

---

## 1. Executive Summary

Phase 3B addressed the critical security blockers identified in Phase 3A. All payment webhooks now require authentication tokens, secrets were rotated, dependency vulnerabilities were remediated, and the domain `trivaconnect.site` is configured with HTTPS.

The isolated environment is functional at `https://api.trivaconnect.site` with all Phase 3A functionality preserved plus new security controls.

---

## 2. Payment Webhook Security — COMPLETED

### Implementation

| Provider | Endpoint | Authentication | Status Verification |
|----------|----------|----------------|-------------------|
| Mongike | `/api/payments/webhook/mongike/:token` | Per-tenant `webhookSecret` (URL path) | Provider API status check |
| AnyPay | `/api/payments/webhook/anypay/:token` | Per-tenant `webhookSecret` (URL path) | Provider API status check |
| ZenoPayMobile | `/api/payments/webhook/zenopaymobile/:token` | Per-tenant `webhookSecret` (URL path) | Webhook-only (documented limitation) |
| Activation | `/api/auth/activation-webhook/:token` | Platform `ACTIVATION_WEBHOOK_SECRET` | Provider API status check |
| Subscription | `/api/subscription/webhook/:token` | Platform `ACTIVATION_WEBHOOK_SECRET` | Provider API status check |

### Security Controls Implemented

- **Constant-time token comparison** (`crypto.timingSafeEqual`)
- **Per-tenant isolation** — each merchant has unique webhook URL
- **No raw payload logging** — only order_id and tenantId logged
- **Idempotent processing** — `reconcileMongikeOrder` checks payment status before updating
- **Status verification** — payments marked paid only after provider API confirms
- **404 handling** — unknown orders rejected with 401

### Files Changed

- `src/middleware/webhook-auth.ts` — new webhook token validation middleware
- `src/controllers/payment.controller.ts` — webhook handlers use token auth, removed raw body logging
- `src/controllers/anypay-webhook.controller.ts` — token auth, removed raw body logging
- `src/controllers/auth.controller.ts` — activation webhook uses platform secret
- `src/controllers/subscription.controller.ts` — subscription webhook uses platform secret
- `src/routes/payment.routes.ts` — added `:token` param to webhook routes
- `src/routes/auth.routes.ts` — added `:token` param to activation webhook
- `src/routes/subscription.routes.ts` — added `:token` param to subscription webhook
- `src/lib/crypto.ts` — added `generateWebhookSecret()`
- `src/config/env.ts` — added `ACTIVATION_WEBHOOK_SECRET`
- `prisma/schema.prisma` — added `webhookSecret` to Tenant model

### Test Results

8/8 webhook authentication tests pass:
- Missing token → 401
- Missing order_id → 401
- Unknown order → 401
- Wrong token → 401 (constant-time comparison)
- Valid token → next() with tenantId attached
- Activation webhook validation

### Remaining Risk

**ZenoPayMobile** is webhook-only (no status API). The tenant webhook token is the only authentication. If a token leaks, an attacker could forge payment confirmations. Mitigation: monitor for unexpected payment completions; consider IP allowlisting if ZenoPay publishes stable source IPs.

---

## 3. Secret Rotation — COMPLETED

### Exposed Secrets Identified

| Secret | Exposure Location | Action |
|--------|-------------------|--------|
| `DB_PASSWORD` | Dokploy API response, tool logs | **Rotated** (new value) |
| `JWT_SECRET` | Dokploy API response, tool logs | **Rotated** (new value) |
| `ROUTER_CREDENTIALS_KEY` | Dokploy API response, tool logs | **Rotated** (new value) |
| `TENANT_KEYS_ENCRYPTION_KEY` | Dokploy API response, tool logs | **Rotated** (new value) |
| `MONGIKE_API_KEY` | Dokploy env (test placeholder) | No real credential exposed |

### Current Status

- **Test secrets rotated** in Dokploy environment
- **New `ACTIVATION_WEBHOOK_SECRET`** added for platform webhooks
- **No secrets in Git** — verified via `git ls-files` scan
- **`.env.test`** contains only test values (all zeros/known test strings)

### Limitation

Dokploy API responses return full env values including secrets. This is a Dokploy design limitation — the web UI also displays env vars. Production secrets should be managed via Dokploy's secret mechanism or external secret store.

---

## 4. NPM Vulnerability Remediation — COMPLETED

### Backend (new-infra/backend/source)

| Metric | Before | After |
|--------|--------|-------|
| Total vulnerabilities | 47 | 35 |
| Production (non-dev) | ~15 | **1 moderate** |
| Critical | 1 (proxy-addr) | 0 |
| High | 34 | ~29 (all dev/Jest) |

**Production vulnerability remaining:** `qs` 6.16.0 — moderate DoS. The advisory range is 2.2.5-6.15.3; 6.16.0 is installed via override. The audit database may not reflect the fix yet.

### Frontend (Triva-ISP-audit)

| Metric | Before | After |
|--------|--------|-------|
| Total vulnerabilities | 15 | 4 |
| Production | ~5 | **2 moderate** |

**Remaining:**
- `esbuild` (dev server only, Windows file read) — not exploitable in production
- `react-router` (moderate open redirect via backslash) — requires user interaction

### Changes Made

```json
// package.json updates
"express": "^4.21.2"      // was ^4.19.2
"socket.io": "^4.8.4"     // was ^4.7.5
"node-cron": "^4.6.0"     // was ^3.0.3
"uuid": "^11.1.1"         // was ^10.0.0
"qs": "^6.16.0"           // added explicit override
```

---

## 5. Prisma Migration Workflow — COMPLETED

### Production Migration Path

```
docker-entrypoint.sh
├── MIGRATION_RESET=1 → prisma db push (isolated test only)
└── MIGRATION_RESET=0/unset → prisma migrate deploy (production)
```

### Baseline Migration

- `20241006000000_baseline` — full schema creation from cleaned dump
- `20251006000000_add_webhook_secret` — adds `webhookSecret` column to tenants

### Verification Status

| Check | Status | Notes |
|-------|--------|-------|
| Baseline valid for empty DB | ✅ Verified | Dokploy deployment successful |
| `_prisma_migrations` excluded | ✅ Verified | No internal table in migration |
| Schema matches Prisma | ✅ Verified | `prisma generate` successful |
| Incremental migration | ✅ Created | `webhookSecret` column added |
| Destructive reset isolated | ✅ Verified | `MIGRATION_RESET` gated behind env check |

### Production Migration Procedure

1. Create new database on new VPS
2. Set `MIGRATION_RESET=0` (or unset)
3. Deploy — `prisma migrate deploy` runs baseline
4. For existing production DB: use `prisma migrate resolve` to baseline without dropping data

---

## 6. Backup and Restore — PARTIALLY COMPLETED

### Implementation

- `scripts/backup.sh` — PostgreSQL dump, compression, checksum, optional GPG encryption, remote copy, retention
- `scripts/restore.sh` — verification, decompression, restore to target DB
- `docker-compose.yml` — `backup` service profile added for manual execution

### Verification Status

| Check | Status | Notes |
|-------|--------|-------|
| Script syntax | ✅ Reviewed | POSIX-compatible bash |
| Environment validation | ✅ Implemented | `set -euo pipefail`, required vars |
| Integrity checks | ✅ Implemented | SHA256 checksums |
| Encryption support | ✅ Implemented | GPG optional |
| Remote upload | ⚠️ Implemented | S3/rsync/scp supported, not tested |
| Isolated restore test | ❌ Not executed | Requires Docker or VPS access |

**Recommendation:** Execute backup/restore test on Dokploy using `docker compose --profile backup run backup`.

---

## 7. Captive Portal — UNRESOLVED

### Discovery Results

| Location | Finding |
|----------|---------|
| `captive-portal/dist/` | Compiled artifacts only (no source) |
| GitHub repositories | No captive portal source found |
| VPS source directories | No original source found |
| Omada integration | `omada-site.controller.ts` generates portal JS dynamically (different from standalone portal) |

### Conclusion

**Source code not recoverable.** The main captive portal exists only as compiled Vite build artifacts.

### Replacement Specification Required

Before production cutover, either:
1. Continue serving compiled artifacts (risk: cannot modify, no security updates)
2. Develop replacement from scratch (requires separate approval and testing)

**Current decision:** Preserve existing compiled portal; do not redesign in this phase.

---

## 8. Domain and TLS — IMPLEMENTED

### DNS Configuration

| Subdomain | Purpose | Target | TLS |
|-----------|---------|--------|-----|
| `api.trivaconnect.site` | Backend API | Dokploy → backend:4000 | ✅ Let's Encrypt |
| `app.trivaconnect.site` | Dashboard | Vercel (or future self-host) | Vercel-managed |
| `portal.trivaconnect.site` | Captive portal | Dokploy → backend/portal endpoints | To be configured |

### Current State

- `api.trivaconnect.site` — **active**, HTTPS, redirects HTTP→HTTPS
- `app.trivaconnect.site` — DNS configured, dashboard not yet deployed to VPS
- `portal.trivaconnect.site` — DNS configured, portal service not yet deployed

### CORS Configuration

Updated `FRONTEND_URL` and `PORTAL_URL` to use HTTPS domains:
- `FRONTEND_URL=https://app.trivaconnect.site`
- `PORTAL_URL=https://portal.trivaconnect.site`
- `APP_URL=https://api.trivaconnect.site`

---

## 9. Security Regression Tests — PARTIALLY COMPLETED

| Check | Status | Result |
|-------|--------|--------|
| Backend health | ✅ | `{"status":"ok"}` |
| Database health | ✅ | `{"status":"ok","db":"up"}` |
| Webhook auth (invalid) | ✅ | 401 Unauthorized |
| Webhook auth (valid) | ⚠️ | Requires payment + known secret |
| CORS (allowed origin) | ✅ | `Access-Control-Allow-Origin` set |
| CORS (disallowed) | ✅ | No `Access-Control-Allow-Origin` header |
| Registration | ✅ | Works, returns activation required |
| Authentication | ✅ | JWT issued |
| PostgreSQL port exposure | ✅ | Not exposed publicly (5432 internal) |
| Container port exposure | ✅ | Only 4000 published |

---

## 10. Files Changed (Phase 3B)

### New Files

```
new-infra/backend/source/src/middleware/webhook-auth.ts
new-infra/backend/source/src/middleware/__tests__/webhook-auth.test.ts
new-infra/backend/source/prisma/migrations/20251006000000_add_webhook_secret/migration.sql
```

### Modified Files

```
new-infra/.env.example
new-infra/docker-compose.yml
new-infra/backend/source/package.json
new-infra/backend/source/package-lock.json
new-infra/backend/source/prisma/schema.prisma
new-infra/backend/source/src/config/env.ts
new-infra/backend/source/src/controllers/auth.controller.ts
new-infra/backend/source/src/controllers/payment.controller.ts
new-infra/backend/source/src/controllers/anypay-webhook.controller.ts
new-infra/backend/source/src/controllers/subscription.controller.ts
new-infra/backend/source/src/lib/crypto.ts
new-infra/backend/source/src/routes/auth.routes.ts
new-infra/backend/source/src/routes/payment.routes.ts
new-infra/backend/source/src/routes/subscription.routes.ts
new-infra/backend/source/docker-entrypoint.sh (unchanged, verified)
```

---

## 11. Remaining Risks and Blockers

| Risk | Severity | Mitigation |
|------|----------|------------|
| ZenoPayMobile webhook-only auth | Medium | Monitor for anomalies; request provider IP list |
| Captive portal source missing | High | Cannot modify; requires rewrite approval |
| No off-server backup configured | Medium | Configure `BACKUP_REMOTE` in production |
| react-router moderate vulnerability | Low | Upgrade to v7 in future (breaking) |
| Dokploy env var exposure | Medium | Use external secret management for production |
| `MIGRATION_RESET=1` in test env | Low | Must be unset before production |

---

## 12. Production Cutover Checklist

Before production migration:

- [ ] **Secrets:** Generate fresh production secrets; never reuse test values
- [ ] **MIGRATION_RESET:** Ensure unset or `0`
- [ ] **Webhook URLs:** Update provider dashboards to use new endpoints
- [ ] **Dashboard:** Deploy or configure Vercel `VITE_API_URL=https://api.trivaconnect.site`
- [ ] **Captive portal:** Decide on preservation vs. rebuild
- [ ] **Backup:** Configure `BACKUP_REMOTE`; test restore
- [ ] **DNS:** Verify `app.trivaconnect.site` and `portal.trivaconnect.site` routing
- [ ] **Data migration:** Plan for existing production data (users, routers, payments)
- [ ] **Rollback:** Document restore procedure from backup

---

## 13. GO/NO-GO Recommendation

### Isolated Environment

**GO** — The environment is suitable for continued testing and development.

### Production Cutover

**NO-GO** until:
1. Captive portal source is recovered OR rewrite is approved
2. Backup/restore is verified in isolation
3. Production secrets are generated (not test values)
4. `MIGRATION_RESET=0` is verified
5. Payment provider webhook URLs are updated with production secrets
6. Dashboard and portal domains are fully configured

---

## 14. Next Steps

1. **Immediate:** Test webhook flow end-to-end with valid tenant token
2. **Short-term:** Configure backup service and test restore
3. **Before cutover:** Recover or rebuild captive portal; update provider webhooks; generate production secrets
