# Phase 3C — Backup Proof, Security Validation & Cutover Readiness

**Date:** 2026-10-07
**Scope:** Isolated Dokploy environment only (`triva-wifi-2bgnhn`, API `https://api.trivaconnect.site`). The legacy production VPS was not touched at any point.

Legend: **VERIFIED** = executed test with observed output · **INSPECTED** = code/config review only · **PROPOSED** = designed, not yet applied · **UNRESOLVED** = blocked, needs decision.

---

## Executive Summary

Phase 3C converted the isolated environment from "deployed but unproven" into a
**tested candidate** by executing the backup/restore cycle, attacking the webhooks
live, proving the production migration path end-to-end, and hardening everything
found along the way.

Six real defects were found and fixed during this phase — including a broken
backup script, a baseline migration that could never apply, a webhook
trust-bypass, and a credential leak in error logs.

**Final recommendation: NO-GO for production cutover.** The isolated candidate
is significantly stronger, but the captive portal source is unrecovered,
production secrets do not exist yet, backup automation is unconfigured, and the
happy-path payment completion has never been verified against a real provider
sandbox.

---

## A. Backup & Restore — VERIFIED

### A.1 Script defects found and fixed

| Defect | Impact | Fix |
|---|---|---|
| `pg_dump --single-transaction` | Flag does not exist for `pg_dump`; script would have produced an empty/corrupt dump on first real run | Removed (commit `81190f5`) |
| `psql` restore without `ON_ERROR_STOP` | Corrupt-but-gzip-valid dump exits 0, leaves a partial restore | Added `--single-transaction -v ON_ERROR_STOP=1` (commit `7bab0c8`) |
| `migrate resolve` covered baseline only | Second migration left unresolved after restore | Resolves both applied migrations (commit `7bab0c8`) |

### A.2 Executed backup — VERIFIED

Ran `new-infra/scripts/backup.sh` unmodified inside the `triva-postgres` container:

- Output: `triva-db-20261007-064337.sql.gz` (4,988 bytes) + `.sha256` + `.summary`
- `gunzip -t` → OK (compressed integrity)
- `sha256sum -c` → OK (checksum file verified)
- Dump contains 13 `CREATE TABLE` statements; summary records sha256
  `018430d6…421e6` and timestamp
- A manual dump taken earlier the same way produced matching structure

### A.3 Executed restore — VERIFIED

Restored into disposable databases, never the source:

| Target | Result |
|---|---|
| `triva_db_restore` | Full restore OK; table list **byte-identical** to source (13 tables, 46 indexes, matching index names) |
| `triva_db_atomic` | Restored via hardened `--single-transaction` path → `ATOMIC_RESTORE=OK` |

Representative record verification (source = restored): 2 tenants, 2 users,
`tenants."webhookSecret"` present with identical presence/length, matching
row counts for sessions/payments/plans/routers/vouchers.

### A.4 Application against restored DB — VERIFIED

Started a second backend instance (port 4100) inside the backend container
pointed at `triva_db_restore`:

- `GET /health` → `{"status":"ok"}`; `GET /health/db` → `{"db":"up"}`; startup log: `Database connected`
- Registered `restore-test@example.com` → success, JWT issued
- Login → JWT issued; `GET /api/auth/me` → user + restored tenant returned
- `POST /api/plans` → plan created; `GET /api/plans` → returns it (tenant-scoped)
- PENDING tenant correctly denied merchant APIs (`Tenant account is suspended or not found`) — authorization boundary works

### A.5 Failure handling — VERIFIED

| Scenario | Observed |
|---|---|
| Corrupt SQL inside valid gzip | `ERROR: syntax error`, exit code **3** |
| Partial-then-invalid dump | **0 tables** restored — single transaction rolled back fully |
| `migrate deploy` over failed-migration record | `P3009` — refuses to continue until resolved (correct) |
| `prisma migrate resolve --applied` | Fixed both restore and source DBs; `migrate status` → "Database schema is up to date!" |

### A.6 Retention & off-server — PARTIALLY VERIFIED

- `RETENTION_DAYS` (default 14) deletes expired backup artifacts — INSPECTED
- Optional GPG encryption (`GPG_RECIPIENT`) — INSPECTED, not exercised
- Optional off-server upload: S3, scp, rclone (`BACKUP_REMOTE`) — INSPECTED, not exercised
- **UNRESOLVED:** no scheduler runs backups yet (compose `backup` service profile exists but is not deployed); no off-server destination configured. For production: scheduled container/cron + off-site object storage (or volume snapshots) with restore drills.

**Recovery procedure (validated):**
1. `DROP DATABASE` + `CREATE DATABASE` on target
2. `gunzip -c backup.sql.gz | psql -v ON_ERROR_STOP=1 --single-transaction`
3. `prisma migrate resolve --applied <each-applied-migration>` (existing-DB baselining)
4. Point `DATABASE_URL` at the DB, start backend, verify `/health/db`

---

## B. Webhook Security — VERIFIED (15/15 attack tests passed)

Executed a live attack suite (`scripts/whtest.js`) from inside the backend
container against `http://localhost:4000`, with synthetic PENDING payments and
the real tenant `webhookSecret` (never printed):

| # | Test | Result |
|---|---|---|
| 1 | Missing token | 404 |
| 2 | Invalid token | 401 |
| 3 | Unknown `order_id` + valid token | 401 |
| 4 | Missing `order_id` | 401 |
| 5 | **Forged `COMPLETED` + valid token** | 200 received, payment **stays PENDING** |
| 6 | Forged `FAILED` + valid token | 200, stays PENDING (can't grief-fail) |
| 7 | Cross-tenant order + wrong tenant token | 401, PENDING |
| 8 | 5× concurrent duplicate deliveries | all 200, PENDING — idempotent |
| 9 | Spoofed amount/currency in body | ignored — body values never trusted |
| 10 | AnyPay forged `COMPLETED` + valid token | 200, stays PENDING |
| 11 | ZenoPay valid-token `COMPLETED` | 200, **COMPLETED** (token-only boundary) |
| 12 | ZenoPay invalid token | 401, PENDING |
| 13 | Malformed body | 401 |
| 14 | Activation webhook invalid token | 401 |
| 15 | Subscription webhook invalid token | 401 |

### B.1 Critical fix applied — VERIFIED

All Mongike/AnyPay/platform webhook handlers previously forwarded the callback's
claimed `status` into `reconcileMongikeOrder` via `remoteOverride`, meaning
**anyone holding a tenant webhook URL could mark payments paid without the
provider ever confirming**. Handlers now act as triggers only — the reconciler
always queries the provider status API before completing (commit `f71b74a`).

Live proof: the forged AnyPay callback triggered a real outbound
`GET /check-order-status/?order_id=…` to `anypaytanzania.com` (403 with test key)
— payment stayed PENDING. Verified in container logs.

### B.2 Provider capability inventory

| Provider | Signature auth | Status API | Implemented verification | Classification |
|---|---|---|---|---|
| Mongike | None documented — UNRESOLVED | `GET /api/v1/payments/{orderId}` | URL token + provider API status check | VERIFIED (status endpoint exercised; sandbox happy-path pending) |
| AnyPay (Selcom) | None documented — UNRESOLVED | `GET /check-order-status/` | URL token + provider API status check | VERIFIED (live outbound call observed) |
| ZenoPayMobile | No signature; docs show optional `X-API-KEY` header echo | `GET /order-status?order_id=` exists per official repo | **URL token only** — per user instruction, left unchanged | VERIFIED behavior; **documented risk** |

**ZenoPayMobile risk (documented):** a leaked webhook URL allows forged
payment completion for that tenant. Official ZenoPay docs show an
`order-status` endpoint and an `X-API-KEY` webhook header — both could
close this gap if/when approved. Not implemented per "leave zeno alone".

### B.3 Brute-force / replay — VERIFIED

- Webhook endpoints rate-limited at 30 req/min per IP: 30×401 then `429` — confirmed live
- `trust proxy: 1` set so limiting uses real client IP behind Dokploy's proxy
- Idempotency: `reconcileMongikeOrder` ignores non-PENDING payments — duplicates/out-of-order events cannot double-complete
- Replay of identical callbacks: 5×200, single stable state
- Comparison via `crypto.timingSafeEqual`

### B.4 Token secrecy — VERIFIED

- Middleware/controllers log `orderId`, `provider`, `tenantId`, `ip` — never the token (log files inspected)
- **Fixed:** axios error objects serialized `config.headers` (would leak `API-Key`/`x-api-key`/`Authorization` in production) — now logs status+message only (commit `847b5d8`)
- Responses return generic `{received:true}`/`401` — no token echo

---

## C. Secret Isolation — VERIFIED (with findings)

| Check | Result |
|---|---|
| Secret patterns in tracked files (deployed repo) | Clean |
| Secret patterns in git history | Clean |
| `.env.test` tracked? | Not tracked in deployed repo (`.env.*` ignored, `.env.example` allowed) — **but tracked in local `Triva-WiFi-Phase2/new-infra` repo (no remote — low risk, flagged)** |
| Frontend `dist/` bundle | Clean — no keys/secrets/`VITE_` leakage |
| Log files | Clean after axios-header fix; no token/secret values found |
| API responses | No secret material (401/generic only) |
| Docker image layers | Not directly inspectable via Dokploy API — INSPECTED via `.dockerignore` + env-only secret injection |
| Dokploy API | **`compose.one`/`compose.update` echo full env including secrets** — observed in tool output. All such values are test-only and must be regenerated for production |

**Test-only credentials (must NOT be reused in production):** DB password,
JWT secret, Mongike/AnyPay test keys, `ACTIVATION_WEBHOOK_SECRET`,
`ROUTER_CREDENTIALS_KEY`, `TENANT_KEYS_ENCRYPTION_KEY`, Dokploy session tokens.

**Production-only secrets to generate at cutover:** all of the above +
production payment-provider credentials + (recommended) per-tenant webhook
secrets regenerated for existing tenants.

**Encryption-key recovery:** router credentials, tenant API keys and Omada
RADIUS secrets are AES-256-GCM encrypted at rest. Losing
`ROUTER_CREDENTIALS_KEY`/`TENANT_KEYS_ENCRYPTION_KEY` = permanent data loss for
those fields — keys must be escrowed (e.g., offline password manager + Dokploy
secrets) before production data exists.

---

## D. Database Migrations — VERIFIED

| Test | Result |
|---|---|
| `migrate deploy` on empty DB | **Initially failed P1014** — baseline contained `set_config('search_path','',false)` (pg_dump artifact) that broke Prisma's bookkeeping. Fixed (commit `8f59969`) → **both migrations apply; 14 tables, 48 indexes, 17 FKs** |
| `migrate status` post-deploy | "Database schema is up to date!" |
| Failed-migration handling | `P3009` correctly blocks until `migrate resolve` |
| Existing-DB baselining | `migrate resolve --applied` both migrations → `migrate deploy` becomes no-op — verified on `triva_db` and `triva_db_restore` |
| Production startup path | `MIGRATION_RESET=0` deployed → entrypoint ran `migrate deploy` → container healthy |
| Destructive path isolation | `db push --accept-data-loss` only when `MIGRATION_RESET=1`; currently `0` in the isolated env |
| `nas` table parity | Fresh `migrate deploy` DB includes `nas`; `db push`-built DBs lack it (not in `schema.prisma`) — production MUST use `migrate deploy` |
| Rollback | Additive migrations only; no down-migrations — recovery = restore from backup. Irreversible steps documented |

**Fresh-install reproducibility:** verified — empty DB → `migrate deploy` →
full schema. **Existing-DB procedure:** verified — baseline the existing schema
by marking migrations applied, then `migrate deploy` governs future changes.

---

## E. Captive Portal — NOT FOUND (searched, stopped per instructions)

**Search scope (VERIFIED):**
- `Triva-ISP-audit` — all branches (`main`, `phase3a-new-infra`, `origin/main`), full history — no portal source
- `Triva-WiFi-Phase2` — `captive-portal/`, `current-captive-portal/`, `frontend/` — only compiled `dist/` bundles; `current-captive-portal` is empty
- Workspace repos — NetPilot (empty), `mongike-frontend`, `zenopay-V2-frontend`, `Tucheki`, `TrivaPay` — none are the Triva WiFi captive portal
- Omada portal JS **is** present (`generatePortalJs` in `omada-site.controller.ts`) — separate component, not the main portal

**What was found:** compiled Vite bundle `captive-portal/dist/assets/main-DM5Hsyz7.js` (~270KB). Extracted API surface (useful for any replacement spec):
- `GET /portal/router/{id}?mac=…` — router/plan discovery
- `GET /portal/session/{id}` — session status polling
- `POST /payments/portal/initiate` — payment initiation
- `POST /portal/redeem-voucher` — voucher redemption
- Socket.IO for realtime payment confirmation
- **Hardcoded base URL `https://triva.pandabus.live/api`** — the compiled bundle cannot be repointed to `trivaconnect.site` without rebuilding

**Functional replacement requirements (if approved):** router detection +
MAC capture, plan listing per tenant, payment initiation → USSD push, realtime
payment confirmation (socket), session activation → credentials display,
voucher redemption, expiry/failure states, MikroTik + Omada variants,
HTTPS-compatible captive detection.

**Status: UNRESOLVED — requires engineering decision** (rebuild from spec vs.
source recovery attempt on old VPS backups).

---

## F. Isolated Regression — VERIFIED (what was run) / UNRESOLVED (what wasn't)

**Executed against the live isolated API:**

- Register → success + `activationRequired`; Login → JWT; `/me` → user+tenant; unauthenticated `/me` → 401
- CORS: `https://app.trivaconnect.site` → `Access-Control-Allow-Origin` echoed + credentials; `https://evil.com` → no ACAO header (browser-blocked)
- Security headers: HSTS `max-age=15552000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`
- HTTP→HTTPS 301; Let's Encrypt cert valid (CN=api.trivaconnect.site, issuer YR2)
- Webhook rate limit: 30/min → 429 (verified live)
- **Added:** dedicated auth limiter on `/login` + `/register` (20/15min) — previously only the global 200/15min applied (commit `8f522dd`)
- PostgreSQL: `5432/tcp` internal only, **not published**; external connection attempt refused
- DB persistence: postgres container stable through all backend redeploys; all data intact
- Plan CRUD + tenant authorization boundary verified on restored DB
- Unit tests: 24/26 pass locally; 2 DB-integration tests time out (no localhost Postgres — environment limit, not a regression); webhook-auth suite 17/17, crypto 9/9 inside CI-equivalent runs

**NOT verified (honest limits):**
- Real router sync/activation — no physical router in the isolated env; all router paths remain **UNRESOLVED** until a lab router exists
- Happy-path payment completion — requires provider sandbox credentials; only the *rejection* paths are proven
- Captive portal end-to-end — blocked on section E
- Session lifecycle against real RADIUS — mocked only

---

## G. Dependencies — VERIFIED

**Backend (`npm audit`):**
- **Production dependencies: 0 vulnerabilities**
- Dev dependencies: 35 findings — all inside the Jest/Babel test toolchain (`braces`/`micromatch` ReDoS class, `js-yaml`, `sprintf-js`, `esbuild` dev-server). **No runtime exposure** — not shipped in the production image's runtime path beyond test files.

**Frontend (`npm audit`):**
- Production: 2 moderate — `react-router`/`react-router-dom` 6.27.x:
  - `GHSA-wrjc-x8rr-h8h6` open redirect via backslash in `<Link>`/`useNavigate` — relevant only if app navigates to user-controlled URLs (review needed)
  - `GHSA-337j-9hxr-rhxg` SSR hydration injection — **not applicable**, Vite SPA has no SSR
  - Fix = react-router-dom 7.18.x (**major upgrade** — deferred per "no blind major upgrades"; needs migration review)
- Dev: `vite` 5.4.x + `esbuild` — dev-server-only findings (`.map` traversal, `server.fs.deny` bypass, NTLM relay); **not in production static output**. Fix = vite 8 (major — deferred)

---

## Files changed this phase (branch `phase3a-new-infra`)

| Commit | Change |
|---|---|
| `81190f5` | Lazy `webhookSecret` backfill (payment + omada controllers); webhooks inside payment rate limiter (30/min); removed invalid `pg_dump --single-transaction`; optional compose `backup` service profile |
| `8f59969` | Removed `search_path` reset from baseline migration (fixed P1014) |
| `f71b74a` | Removed `remoteOverride` trust from all webhook handlers — provider API verifies status (anypay/payment/auth/subscription controllers) |
| `847b5d8` | Sanitized axios error logging (anypay/mongike gateways + mongike.service) — no header/secret leakage |
| `8f522dd` | Dedicated rate limiter on `/api/auth/login` + `/api/auth/register` |
| `7bab0c8` | Atomic fail-fast restore (`--single-transaction -v ON_ERROR_STOP=1`); resolve both migrations post-restore |

## Remaining blockers

1. **Captive portal source unrecovered** — compiled bundle hardcodes `triva.pandabus.live`; cannot serve customers on the new domain without a rebuild decision.
2. **Production secrets do not exist** — all deployed values are test-only (several echoed via Dokploy API); generate fresh at cutover.
3. **Backup automation unconfigured** — scripts verified but no schedule or off-server destination.
4. **ZenoPayMobile token-only boundary** — documented risk; an approved `order-status` check or `X-API-KEY` header validation could close it.
5. **Happy-path payment unproven** — needs provider sandbox credentials.
6. **`app.`/`portal.` subdomains not deployed** — only `api.` runs; dashboard still on Vercel, portal blocked on E.
7. **React Router 6→7 migration** — moderate CVEs, needs a planned upgrade + regression.
8. **VPS is shared** — many other Dokploy projects coexist; production isolation hardening (resource limits, network segmentation) worth a decision.

## Production migration prerequisites (validated order)

1. Approve captive portal replacement OR recover source.
2. Generate all production secrets in Dokploy (never reuse test values).
3. Configure backup schedule + off-server destination; run a scheduled backup + restore drill.
4. Point DNS: `api.` → Dokploy (done for isolated), `app.` → dashboard host, `portal.` → portal host.
5. Deploy dashboard (or keep Vercel, update `VITE_API_URL`); deploy rebuilt portal.
6. Production DB: fresh install → `migrate deploy` (verified); existing data → baseline via `migrate resolve` then `migrate deploy` (verified).
7. Provider sandbox: verify initiate→callback→status-check→COMPLETED→session activation end-to-end.
8. Rotate every test secret; confirm `MIGRATION_RESET` unset/`0`.
9. Lab router test for MikroTik/Omada sync before customer migration.

## Rollback & recovery plan

- Database: point-in-time restore from `backup.sh` artifacts via verified `restore.sh` path (atomic, checksum-verified).
- App: Dokploy redeploy of last-known-good commit; migrations are additive so older code still runs on newer schema (additive only — destructive migrations documented as requiring data migration planning).
- Legacy production VPS remains untouched and available as fallback through cutover.

## Final GO/NO-GO

- **Isolated candidate:** **GO** — backup/restore proven, webhooks hardened and attack-tested, migration path production-verified, audits clean at runtime.
- **Production cutover:** **NO-GO** — captive portal, production secrets, backup automation, provider sandbox proof, and frontend/portal deployment are unresolved.

Awaiting explicit engineering approval before any production action.
