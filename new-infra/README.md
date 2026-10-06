# Triva WiFi — New Infrastructure

This directory contains the proposed target architecture for deploying the Triva ISP Management System on a **new VPS using Dokploy + Docker Compose**.

## Structure

```
new-infra/
├── docker-compose.yml              # Target Compose stack
├── .env.example                   # Required environment variables
├── backend/
│   ├── Dockerfile                 # Multi-stage Node 20 build
│   ├── ecosystem.config.js        # Reference PM2 fix (not used in Docker)
│   ├── src/lib/crypto.ts          # AES-256-GCM encryption helpers
│   ├── src/scripts/migrate-router-creds.ts  # One-off credential encryption
│   └── prisma/migrations/20241006000000_baseline/  # Baseline migration
├── nginx/
│   └── nginx.conf                 # Reverse proxy with modern TLS
├── scripts/
│   ├── init.sql                   # DB init placeholder
│   ├── backup.sh                  # Encrypted, off-site PostgreSQL backup
│   ├── restore.sh                 # Isolated restore + baseline resolution
│   └── clean-schema.js            # Helper used to clean schema dump
└── proposed-changes/              # Patches to apply to backend source
```

## Quick start (local validation only)

```bash
cp .env.example .env
# Edit .env with strong secrets
docker compose up -d
```

## Migration sequence

1. Back up current `triva_db` using `scripts/backup.sh` or manual `pg_dump`.
2. Provision new VPS with Dokploy and Docker Compose.
3. Restore backup on new VPS using `scripts/restore.sh`.
4. Apply proposed source patches to a new backend Git repository.
5. Run `migrate-router-creds.ts` to encrypt router and tenant credentials.
6. Build and start the Docker stack.
7. Validate captive portal, dashboard, payments, and router sync.
8. Lower DNS TTL and cut over.

## Notes

- The backend container runs a **single Node process**; no PM2 cluster mode.
- Background jobs live in the same container. Do not scale this container horizontally without extracting jobs.
- Router credentials are encrypted at rest using `ROUTER_CREDENTIALS_KEY`.
- Tenant payment keys are encrypted using `TENANT_KEYS_ENCRYPTION_KEY`.
- TLS 1.0 and TLS 1.1 are disabled.
- All secrets are injected via environment variables; nothing sensitive is committed.
