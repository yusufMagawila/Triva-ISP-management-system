# Phase 4 — AnyPay-Only Payment Architecture + Premium Captive Portal Rebuild

**Status:** Implementation complete, isolated verification complete. **Not deployed to production.**
**Environment:** Dokploy project `triva-wifi-2bgnhn` (`api.trivaconnect.site`, `portal.trivaconnect.site`)
**Legacy production VPS:** untouched throughout.

---

## 1. Provider Cleanup

- **ZenoPayMobile removed** — gateway, service, controller, webhook route, enum value, env vars, frontend config, admin settings, tests, docs.
- **Mongike removed** — same surface, plus `payments.mongikeTxId` → `payments.providerTxId` rename and `zenopayRef` dropped.
- **`PaymentProvider` enum** in the live DB now contains exactly `VOUCHER | ANYPAY`.
- Live webhook routes now: `/api/payments/webhook/anypay/:token`, `/api/auth/activation-webhook/:token`, `/api/subscription/webhook/:token`. Mongike/ZenoPay webhook URLs return **404** (verified live).

Active code references removed; historical migration SQL and `docs/` history retain provider names intentionally.

## 2. AnyPay Architecture

**Configuration** (two layers, both DB-driven — no env/source edits needed):

| Scope | Storage | API |
|---|---|---|
| Tenant (WiFi payments) | `tenants.anypayApiKeyEnc` / `anypayBaseUrl` / `anypayEnabled` | `GET/PUT /api/payment-settings` (merchant) |
| Platform (activation + subscription fees) | `platform_settings.anypayKeyEnc` / `anypayBaseUrl` / `anypayEnabled` | `GET/PUT/POST /api/admin/payment-config[/test]` (SUPER_ADMIN) |

- **Encryption:** credentials AES-encrypted at rest (`anypayKeyEnc`/`anypayApiKeyEnc`); verified live — DB contains 128-char ciphertext only.
- **Masking:** API returns `••••••••7890`; plaintext never leaves the backend. Verified live.
- **Credential bundle:** `accessToken::apiKey` (or JSON / legacy single-key); `Authorization` header is only sent when a real access token exists.

**WiFi flow:** portal → `POST /api/payments/portal/initiate` (planId+phone+mac only) → backend loads authoritative plan/price → AnyPay pull → webhook → **reconciliation queries AnyPay status API** → COMPLETED → session activation (direct MikroTik push, else pull-sync).

**Subscription flow:** `POST /api/subscription/pay` → platform AnyPay → webhook → status verification → subscription extended. Idempotent (duplicate callback → `expiresAt` unchanged, verified live).

**Idempotency:** completed/failed payments return `ignored`; concurrent duplicate deliveries safe (verified: 5×200, state unchanged).

## 3. Captive Portal

New app at `new-infra/captive-portal/` (React 18 + TS + Vite, plain CSS). Deployed as `triva-portal` container behind `portal.trivaconnect.site` with `/api` + `/socket.io` proxied to `triva-backend`.

Implemented and verified:

- **Router detection** — `?router=` (MikroTik/TP-Link) or `?siteId=`/`vendor=omada` (Omada) query params.
- **MAC/client handling** — `mac` param passed through to session create/status.
- **Tenant identification** — via router/site lookup only; browser-supplied `tenantId` is never trusted for isolation (verified: wrong-tenant request → 403).
- **Package discovery** — `GET /api/portal/router/:id?mac=` → plans rendered dynamically, no hardcoded prices.
- **Package cards** — name, TZS price, duration, speed, data cap, popular badge on the longest-plan < median selection; horizontal swipe strip on mobile, responsive grid on desktop.
- **Checkout sheet** — bottom sheet (mobile) / centered card (desktop), order summary, phone input.
- **Phone validation** — TZ formats (0712…, +255…, 255…); backend 422 on invalid (verified).
- **AnyPay initiation** — processing state, double-submit disabled, provider detail never exposed.
- **Realtime status** — Socket.IO `portal:subscribe {macAddress, tenantId}` → `session:activated` / `payment:failed` / `session:expired`.
- **Polling fallback** — `GET /api/portal/session/:id` every 4s when socket fails or times out.
- **Success / failure / expired** states with distinct visuals and retry paths.
- **Session activation** — MikroTik: hidden PAP form POST to `link-login` (provisioning sets `login-by=http-pap,http-chap,cookie`); Omada: `GET /api/omada/redirect/:sessionId` → bounce to controller with `triva_token`.
- **Session status** — returning users see active session + expiry (server-truth only).
- **Voucher redemption** — code entry sheet; handled states: valid → session + credentials; used → 409; expired → 410; invalid → 404 (all verified live).
- **Tenant branding** — logo/name/notice name+message+color via `portalNotice*` fields.
- **Support** — notice card renders tenant's configured contact message.
- **MikroTik** — consumes `router`, `mac`, `ip`, `link-login`, `link-orig` params; router pull-sync fallback works when direct activation is unreachable (verified: `SOCKTMOUT` → credentials issued, session PENDING, `sync.rsc` serves the RouterOS provisioning script to an authenticated router).
- **TP-Link/OpenWrt** — `tplink` splash params + `/tplink/:routerId/splash.html` fallback page served.
- **Omada** — `siteId`, `clientMac`, `triva_token` flow verified end-to-end: voucher → ACTIVE session + `radius_users` row + single-use token → credentials exchange (replay → 401).
- **Accessibility** — semantic buttons, focus-visible rings, `prefers-reduced-motion`, `aria-live` status updates, safe-area viewport.
- **Performance** — pure-CSS boot splash before JS; socket.io lazy-loaded.

## 4. UI / Visual Direction

- **Typography:** system stack (`-apple-system, SF Pro Text, Segoe UI, Roboto`), 15–28px scale, tight tracking on headings.
- **Spacing:** Apple-style 8pt rhythm, generous whitespace, `100dvh` layouts.
- **Arrangement:** mobile = snap-scrolling plan strip with popular card elevated; desktop = emphasized grid. No Omada cloning — original card geometry, custom iconography (inline SVG, no icon lib).
- **Cards:** 24px radii, soft layered shadows, glassy translucent sheet with backdrop blur.
- **Animation:** subtle rise/slide entrances, spinner for pending, pulse on status — all disabled under `prefers-reduced-motion`.
- **Palette:** light surfaces (#f5f5f7 base, white cards) + tenant accent color.

## 5. Testing — Exact Numbers

| Suite | Result | Notes |
|---|---|---|
| Backend `tsc` build | PASS | clean |
| Dashboard `vite build` | PASS | clean |
| Portal `tsc && vite build` | PASS | JS 42.9 KB (13.4 gzip) + 174.8 KB lazy (55.4 gzip); CSS 20.7 KB (5.1 gzip) |
| Backend Jest (local) | 24/26 | 2 failures = DB-connection timeouts in `beforeAll/afterAll` hooks; no local Postgres |
| `prisma migrate deploy` — fresh DB | PASS | all 3 migrations apply |
| `migrate status` — live DB | PASS | "Database schema is up to date" |
| AnyPay-only schema check | PASS | enum `{VOUCHER,ANYPAY}`, `providerTxId` present, `mongikeTxId`/`zenopayRef` absent |
| **Webhook attack suite** | **14/14 PASS** | run inside backend container |
| Portal info (MikroTik) | PASS | router+tenant+4 plans+notice fields |
| Omada portal-info | PASS | same shape |
| Payment initiate (mock AnyPay) | PASS | 200, sessionId+paymentId |
| Provider-reject initiate | PASS | clean 502, no internals |
| Webhook→COMPLETED (forged amt/ccy in body) | PASS | payment COMPLETED at **authoritative 5000 TZS**; `TXN_mock_*` stored |
| Webhook→FAILED | PASS | payment FAILED, no activation |
| Duplicate webhook | PASS | 200, idempotent |
| Subscription pay + webhook | PASS | 15,000 TZS COMPLETED → subscription ACTIVE +30d; dup unchanged |
| Voucher redeem (valid) | PASS | session + credentials issued |
| Voucher used / expired / invalid | PASS | 409 / 410 / 404 |
| Omada voucher + token exchange | PASS | ACTIVE session + RADIUS user; token single-use (replay 401) |
| Session status endpoint | PASS | status+expiry+plan+credentials |
| Router `sync.rsc` auth | PASS | 401 without token; 200 + valid RouterOS script with HMAC token |
| Socket.IO handshake via proxy | PASS | sid issued, ws upgrade available |
| Admin payment-config GET/PUT/test | PASS | masked output, encrypted storage, 401 unauthenticated, graceful test failure |
| Merchant payment-settings GET | PASS | masked key |
| Wrong-tenant plan access | PASS | 403 |
| Nonexistent plan / bad phone | PASS | 404 / 422 |

### Bugs found and fixed during Phase 4

1. Valid-token webhooks 500'd when tenant had no AnyPay config → now 200-acknowledged, payment stays PENDING.
2. Provider-reject at initiation → unhandled 500 → now 502 + payment marked FAILED.
3. `ACTIVATION_WEBHOOK_SECRET` is base64 (contains `/`) → activation/subscription webhook URLs were **uncallable**; URL-encoding fix applied and verified.
4. Portal nginx proxied to ambiguous `backend` host on shared Dokploy network → pinned to `triva-backend`.
5. Prisma `Decimal` prices serialized as strings broke portal formatting/types.
6. `ImportMeta.env` types missing; redundant dynamic import removed.
7. Migration made idempotent for `db push`-built databases.

## 6. Remaining Blockers / UNRESOLVED

| Item | State |
|---|---|
| Real AnyPay credentials (happy path against live provider) | **UNRESOLVED** — all happy-path verification used an in-container mock implementing the documented AnyPay contract (`/wallet/pull/`, `/check-order-status/`). A real sandbox/production key is required before go-live. |
| Physical MikroTik router test (PAP form submit to `link-login`, real sync) | **UNRESOLVED** — no hardware; HTTP surface + generated script verified. |
| Physical Omada controller test (real redirect + `/portal/radius/auth`) | **UNRESOLVED** — token exchange + RADIUS-user creation verified; controller-side flow untested. |
| Browser screenshots / Lighthouse | **BLOCKED** — no browser/preview available in this environment; bundle sizes reported instead. |
| Socket.IO event delivery to browser | partially verified — handshake through proxy confirmed; live event receipt not observed (no socket client test). |
| Dashboard UI click-through of platform config | partially verified — API verified end-to-end; browser UI not exercised. |
| Test data in isolated DB | left in place (`p4*` rows, test users); mock AnyPay server dies with the backend container; tenant+platform AnyPay config reset to disabled/default. |
| `platform_settings.anypayKeyEnc` test value | contains a fake key — must be replaced before production use. |

## 7. Production Gate

**NO-GO for production cutover** until at minimum: real AnyPay credentials are configured and one happy-path payment completes against the live provider; MikroTik + Omada hardware tests pass; and production secrets/DNS are provisioned under separate approval.

No legacy production changes, DNS changes, migrations, or credential rotations were performed.
