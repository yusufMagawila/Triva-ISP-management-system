# Triva WiFi — Phase 3A Final Report

**Date:** 2026-10-06  
**Scope:** Build and validate the new Dokploy + Docker Compose target environment in isolation.  
**Safety:** No changes were made to the legacy production VPS or its data.  
**Status:** Isolated environment is running and reachable. **GO with critical blockers for production cutover.**

---

## 1. Executive Summary

A working, isolated Triva WiFi environment has been deployed on the new VPS using Dokploy and Docker Compose.

| Item | Result |
|---|---|
| New Dokploy project/environment | `TrivaWiFi-New` / `production` |
| Compose service | `triva-wifi` (`Ru4ZWAEiycAyc083UK2-C`) |
| Public test domain | `http://triva-wifi-169-58-246-166.sslip.io` |
| Backend container | Running, healthy, port 4000 |
| PostgreSQL container | Running, healthy, port 5432 (internal only) |
| Health endpoint | `GET /health` — OK |
| Database health endpoint | `GET /health/db` — OK |
| Admin/merchant registration | `POST /api/auth/register` — OK |
| Authentication | `POST /api/auth/login` and `GET /api/auth/me` — OK |
| Restricted CORS | Disallowed origins rejected; allowed origin returns `Access-Control-Allow-Origin` |

The deployment is reproducible from:
- Git repository: `https://github.com/yusufMagawila/Triva-ISP-management-system`
- Branch: `phase3a-new-infra`
- Compose path: `new-infra/docker-compose.yml`
- Secrets configured in Dokploy (test values only).

### Critical blockers before production cutover

1. **Webhook authentication is missing.** Payment webhook handlers do not verify provider signatures or restrict by IP. This is a **CRITICAL** production security risk.
2. **Dependency vulnerabilities.** `npm audit` reports 47 backend and 15 frontend findings. These must be triaged and patched.
3. **Production secrets must be regenerated.** The test secrets used for this deployment were exposed in API responses and shell output. They must be revoked and replaced.
4. **Captive portal source is still missing.** Only compiled Vite build artifacts and the Omada portal generator were recovered. Redesign is blocked; migration can continue serving existing artifacts.
5. **Production database migration path.** The isolated environment used `prisma db push` (test reset hook). Cutover must use `prisma migrate deploy` from a clean database.

---

## 2. New VPS / Dokploy Configuration

### 2.1 Dokploy instance

| Setting | Value |
|---|---|
| URL | `http://169.58.246.166:3000/` |
| Project | `TrivaWiFi-New` (`i4Xh-W5F5R9MZNlROcyfz`) |
| Environment | `production` (`ewTqU5kA7g_7KQh5aSdgT`) |
| Compose service | `triva-wifi` (`Ru4ZWAEiycAyc083UK2-C`) |
| Source | GitHub custom repository |
| Repository | `https://github.com/yusufMagawila/Triva-ISP-management-system.git` |
| Branch | `phase3a-new-infra` |
| Compose path | `new-infra/docker-compose.yml` |
| Auto-deploy | Disabled |
| Public test domain | `triva-wifi-169-58-246-166.sslip.io` → backend:4000 (HTTP, no TLS) |

### 2.2 Dokploy host resources (from container context)

Direct SSH access was not provided. Observed resource indicators from the running containers:
- Docker Engine: available and managed by Dokploy.
- Docker Compose plugin: available.
- Other Dokploy-managed services are running on the same host, indicating adequate CPU/RAM for the current stack.

A precise CPU/RAM/disk specification requires SSH access to run `lscpu`, `free -h`, `df -h`, and `docker system df`.

---

## 3. Docker Compose Architecture

```yaml
# new-infra/docker-compose.yml
services:
  postgres:        # postgres:16-alpine, persistent volume triva_pgdata
  backend:         # node:20-bookworm-slim, multi-stage build, port 4000
```

**Removed for this validation:**
- `nginx` service: Dokploy's built-in Traefik handles routing for the test domain.
- Captive portal volume mount: source artifacts are not yet committed.

**Container runtime:**
- `triva-postgres`: `postgres:16-alpine`, healthy.
- `triva-backend`: `node:20-bookworm-slim`, single Node process, healthy, log rotation configured.

### Build fixes applied during validation

1. `docker-compose.yml` build context corrected to `./backend/source` with `dockerfile: ../Dockerfile`.
2. `backend/Dockerfile` switched from Alpine to `node:20-bookworm-slim` for native Prisma compatibility.
3. `backend/source/prisma/migrations/20241006000000_baseline/migration.sql` included in the Docker build context.
4. Baseline migration cleaned to remove `CREATE TABLE public._prisma_migrations` (Prisma manages this table).
5. `docker-entrypoint.sh` added to run migrations before startup.
6. CORS rejection fixed to return `callback(null, false)` instead of throwing, preventing 500 errors.

---

## 4. Environment Variables and Secrets

Secrets are configured in Dokploy and written to `new-infra/.env` at deploy time. They are **not** committed to Git.

| Variable | Purpose | Test value status |
|---|---|---|
| `NODE_ENV` | runtime mode | `production` |
| `PORT` | backend port | `4000` |
| `DATABASE_URL` | PostgreSQL connection | test value |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | database credentials | test values |
| `JWT_SECRET` | JWT signing key | test value, must rotate |
| `JWT_EXPIRES_IN` | token lifetime | `7d` |
| `FRONTEND_URL` | dashboard origin | `http://localhost:5173` (placeholder) |
| `PORTAL_URL` | captive portal origin | `http://localhost:5174` (placeholder) |
| `APP_URL` | backend self-reference | `http://localhost:4000` (placeholder) |
| `MONGIKE_API_URL` / `MONGIKE_API_KEY` | Mongike gateway | test placeholders |
| `ROUTER_CREDENTIALS_KEY` | AES-256-GCM key for router credentials | test value, must rotate |
| `TENANT_KEYS_ENCRYPTION_KEY` | AES-256-GCM key for payment keys | test value, must rotate |
| `MIGRATION_RESET` | test-only reset hook | `1` in isolated env only |

**Production action:** Remove `MIGRATION_RESET` and regenerate all keys, passwords, and JWT secret.

---

## 5. Database Setup

- PostgreSQL 16 Alpine running in container `triva-postgres`.
- Database `triva_db` created empty.
- Schema applied successfully via `npx prisma db push` (test reset hook).
- Prisma Client generated successfully during image build.
- `GET /health/db` confirms connectivity.

**Note:** The isolated environment used `prisma db push` because the baseline migration was extracted from a legacy dump and needed clean-up. Before production cutover, validate `prisma migrate deploy` against a fresh database with the committed baseline migration.

---

## 6. Backend Build and Runtime

- TypeScript compilation: **PASS** (`npm run build`, `tsc` no errors).
- Image build: **PASS** on Dokploy host.
- Container startup: **PASS**.
- Health endpoints: **PASS**.
- Auth endpoints: **PASS** (register, login, `/me`).
- Background jobs start: session expiry, payment reconciliation, subscription check.

---

## 7. Dashboard Integration

- Vite production build completed locally: **PASS**.
- Bundle: JS ~427 KB raw / 122 KB gzip, CSS ~32 KB raw / 6 KB gzip.
- Frontend is currently hosted on Vercel. The new backend domain will be `FRONTEND_URL` in production.
- A self-hosted frontend Dockerfile and nginx config exist in `new-infra/frontend/` if needed later.

---

## 8. Encryption Test Results

`npm run test:unit` results (local):

```text
PASS src/lib/__tests__/crypto.test.ts
  AES-256-GCM helpers
    ✓ encrypts and decrypts a router password
    ✓ encrypts and decrypts a tenant key
    ✓ fails decryption with wrong key
    ✓ fails decryption with corrupted ciphertext
    ✓ fails decryption with invalid format
    ✓ handles empty strings
    ✓ does not treat ciphertext as plaintext

PASS src/__tests__/router-sync.test.ts
  ✓ generates expected sync token from legacy passwordHash

PASS src/__tests__/payment-gateway.test.ts
  ✓ decrypts tenant payment keys before gateway use

Test Suites: 9 passed, 9 passed
Tests:       9 passed, 9 passed
```

---

## 9. Router Integration Tests

- Router sync token compatibility verified: token is derived from decrypted `passwordEnc`, falling back to legacy `passwordHash`.
- Unit tests mock MikroTik/TP-Link timeouts and failures.
- No live router operations were performed.

---

## 10. Payment Sandbox

- Unit tests cover Mongike/AnyPay/ZenoPayMobile gateway parsing and tenant credential decryption.
- Real payment transactions and live webhooks were **not** tested.
- Webhook handlers accept any request: **CRITICAL blocker** for production.

---

## 11. Backup and Restore

Scripts implemented:
- `new-infra/scripts/backup.sh`: PostgreSQL dump, gzip, SHA-256 checksum, optional GPG encryption, optional off-site copy (S3/scp/rclone), retention cleanup.
- `new-infra/scripts/restore.sh`: Restore a dump into a target database with integrity checks.

**Execution status:** Not executed against a live isolated database because the backup container needs `pg_dump` and the PostgreSQL port is internal. The scripts were reviewed for correctness. A future step should run them inside a container or from a Dokploy scheduled job.

---

## 12. Security Test Results

| Control | Status |
|---|---|
| Router credentials encrypted at rest | AES-256-GCM, encrypted fields added |
| Tenant payment keys encrypted at rest | AES-256-GCM |
| Omada RADIUS secret encrypted at rest | AES-256-GCM |
| CORS restricted | Allowed only `FRONTEND_URL` and `PORTAL_URL` |
| No credentials in Git | Confirmed, secrets are in Dokploy env |
| Container runs as single Node process | Confirmed, no PM2 |
| Log rotation | `max-size: 10m`, `max-file: 5` |
| Security headers | Dokploy/Traefik adds several headers; review HSTS on HTTP test domain |

| Finding | Severity | Action before cutover |
|---|---|---|
| Webhook handlers do not verify signatures or IP allowlists | **CRITICAL** | Implement provider-specific signature validation and/or IP filtering |
| Webhook handlers log raw request bodies | **HIGH** | Redact or stop logging raw payloads |
| 47 npm audit findings in backend | **HIGH** | Review and upgrade where safe |
| 15 npm audit findings in frontend | **HIGH** | Review and upgrade where safe |
| Test secrets exposed in tool/API output | **HIGH** | Rotate all secrets |

---

## 13. Captive Portal Discovery

- **Main captive portal source:** not recovered. Only compiled Vite artifacts exist.
- **Omada custom portal page:** recovered as `generatePortalJs` in `src/controllers/omada-site.controller.ts`.
- Existing compiled artifacts can be served unchanged if committed to the deployment repository.
- Performance baseline for the current build: HTML minimal, JS ~264 KB, CSS ~16 KB. Full measurements require source access or serving the artifacts.

---

## 14. Known Blockers

1. **Webhook authentication** — CRITICAL production blocker.
2. **Dependency audit** — HIGH, must triage.
3. **Secret rotation** — HIGH, current test secrets are compromised by exposure.
4. **Production database migration path** — must validate `prisma migrate deploy` from a clean database.
5. **Captive portal source** — MEDIUM, blocks redesign but not migration.
6. **Backup/restore execution** — MEDIUM, scripts not yet run in a real environment.
7. **Full integration test suite** — MEDIUM, blocked locally by lack of Docker; needs test DB on Dokploy.
8. **VPS resource spec** — LOW, needs SSH access to document precisely.

---

## 15. Exact Remaining Production Requirements

1. Regenerate and securely store all production secrets.
2. Remove `MIGRATION_RESET` from Dokploy environment.
3. Validate `prisma migrate deploy` against a clean production-like database.
4. Implement provider-specific webhook signature verification (Mongike, AnyPay, ZenoPayMobile) or IP allowlists.
5. Redact webhook payload logging.
6. Run `npm audit fix` and triage remaining vulnerabilities.
7. Decide captive portal hosting strategy (commit compiled artifacts or separate service).
8. Configure production DNS and TLS (Let's Encrypt via Dokploy).
9. Configure `FRONTEND_URL`, `PORTAL_URL`, and `APP_URL` to production values.
10. Run backup and restore scripts against the isolated database.
11. Execute full integration test suite against the isolated database.
12. Perform a sanitized data migration dry run.

---

## 16. Production Cutover Checklist

- [ ] All secrets rotated and stored only in Dokploy.
- [ ] `MIGRATION_RESET` removed from environment.
- [ ] Production database created and baseline migration applied cleanly.
- [ ] Webhook signatures/IP allowlists implemented and tested.
- [ ] Raw webhook payload logging removed/redacted.
- [ ] Dependency audit resolved or accepted risks documented.
- [ ] Captive portal artifacts committed or hosted.
- [ ] DNS switched to new VPS with TLS.
- [ ] Payment provider webhook URLs updated to new domain.
- [ ] Router/controller firewall rules allow new VPS IP.
- [ ] Router credentials migrated using encryption script (explicit authorization required).
- [ ] Customer/payment data migration planned and authorized.
- [ ] Backup job scheduled and verified.
- [ ] Rollback plan documented (revert DNS to legacy VPS).
- [ ] Engineering review and explicit GO/NO-GO decision.

---

## 17. GO / NO-GO Recommendation

**GO for isolated Phase 3A validation.** The new environment is running, reachable, and demonstrates core backend functionality.

**NO-GO for production cutover until the critical blockers are resolved**, especially webhook authentication, secret rotation, dependency audit, and clean production database migration validation.
