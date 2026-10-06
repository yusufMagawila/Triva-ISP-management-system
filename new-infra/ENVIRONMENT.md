# Triva WiFi — Environment Specification

This document separates public configuration from secrets for the new Dokploy/Compose deployment.

## Public configuration

| Variable | Purpose | Example | Required |
|---|---|---|---|
| `NODE_ENV` | Runtime mode | `production` | yes |
| `PORT` | Backend listen port | `4000` | yes |
| `JWT_EXPIRES_IN` | JWT token lifetime | `7d` | yes |
| `FRONTEND_URL` | Dashboard origin for CORS | `https://dashboard.triva.example.com` | yes |
| `PORTAL_URL` | Captive portal origin for CORS | `https://triva.example.com` | yes |
| `APP_URL` | Public backend URL (webhooks) | `https://triva.example.com` | yes |
| `MONGIKE_API_URL` | Mongike base URL | `https://mongike.com` | yes |
| `BACKUP_DIR` | Local backup path | `/var/backups/triva` | yes |
| `BACKUP_REMOTE` | Off-site backup destination | `s3://bucket/backups/` | no |
| `RETENTION_DAYS` | Backup retention | `14` | yes |

## Private secrets (Dokploy secret manager / `.env` only)

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | yes |
| `DB_USER` / `DB_PASSWORD` | PostgreSQL credentials (Compose only) | yes |
| `JWT_SECRET` | ≥32 char signing secret | yes |
| `MONGIKE_API_KEY` | Platform Mongike API key | yes |
| `ROUTER_CREDENTIALS_KEY` | 32-byte AES key for router/RADIUS secrets | yes |
| `TENANT_KEYS_ENCRYPTION_KEY` | 32-byte AES key for tenant payment keys | yes |
| `GPG_RECIPIENT` | Optional backup encryption key ID | no |

## Generating encryption keys

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Test-only variable

| Variable | Purpose | Required |
|---|---|---|
| `MIGRATION_RESET` | Set to `1` in isolated test environments to reset the database schema via `prisma db push`. Must be **unset** for production cutover so `prisma migrate deploy` is used. | no |

## Important rules

- Never commit `.env` or any secret to Git.
- Never log secrets or webhook payloads.
- Use different keys for `ROUTER_CREDENTIALS_KEY` and `TENANT_KEYS_ENCRYPTION_KEY`.
- Rotate keys only through a controlled re-encryption migration.
- Remove `MIGRATION_RESET` and any test secrets before production deployment.
