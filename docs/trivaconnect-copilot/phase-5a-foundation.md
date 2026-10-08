# Phase 5A — Installation Foundation (Implemented)

Status: **implemented in code, unit-tested; NOT exercised against real hardware or a live database.**

This document records what Phase 5A actually built, the security decisions
taken, and the honest list of what is *not* supported. It is the reference the
future Gemini layer must respect: Gemini will only ever produce contract
input — everything below stays deterministic and LLM-free.

---

## 1. Architecture

```
Installer (INSTALLER role / scoped token)
    ↓
/api/install/*  (wizard API — the ONLY surface installers can reach)
    ↓
Installation contract  (requestedConfig → validatedConfig → executedConfig)
    ↓
Policy validator  (services/installation/policy-validator.service.ts)
    ↓
Structured action executor  (services/installation/action-executor.service.ts)
    ↓
Existing typed services  (mikrotik.service / tplink.service / device-registry)
    ↓
MikroTik / TP-Link / Omada assets
```

There is no second execution path. When Gemini arrives it will sit *beside*
the wizard, producing contract JSON — the same validator and executor gate it.

## 2. New models (migration `20261120000000_phase5a_installation_foundation`)

| Model | Purpose |
|---|---|
| `Customer` | End customer of the tenant (the business receiving WiFi). NOT a Tenant. |
| `Site` | One physical premises; links customer ↔ devices ↔ installations. Replaces free-text `location` as the authoritative grouping. |
| `Installation` | One physical installation event. Holds `requestedConfig`/`validatedConfig`/`executedConfig` JSON snapshots, `revision`, `idempotencyKey`, lifecycle status + stage, `executionResults`. |
| `InstallerToken` | Revocable scoped credential (jti, installationId, siteId, scopes, expiresAt, revokedAt). |
| `InstallationSecret` | AES-256-GCM encrypted secret material addressed by `secret://installation/<id>/<secretId>`. `consumedAt` marks executor use. |
| `AuditLog` | Append-only audit: tenant, user, installation, site, action, target, result, correlationId, sanitized metadata. |

New enums: `CustomerStatus`, `SiteStatus`, `SiteInstallationStatus`,
`InstallationStatus` (DRAFT/IN_PROGRESS/WAITING_FOR_HARDWARE/CONFIGURING/
VERIFYING/COMPLETED/FAILED/CANCELLED), `InstallationStage`, `AuditResult`.
`UserRole` gained `INSTALLER`. `Router` gained `siteId`, `model`,
`routerOsVersion`, `discovery` (JSON snapshot), `discoveredAt`.
`TpLinkRouter`/`OmadaSite` gained `siteId`.

## 3. Installation lifecycle

```
DRAFT → IN_PROGRESS → CONFIGURING → VERIFYING → COMPLETED
              ↕ WAITING_FOR_HARDWARE      ↓
              └──────────→ FAILED ←────────┘   (FAILED → IN_PROGRESS retry)
        any → CANCELLED
```

Enforced in `install.controller.ts` (`TRANSITIONS` map). Invalid transitions
return 409 and are audited as DENIED. `COMPLETED` flips the site to
`installationStatus=ONLINE`; `FAILED` flips it to `FAILED`.

## 4. Authorization model

- `UserRole.INSTALLER` — a tenant-scoped field identity.
- Dashboard route files now apply `requireDashboardRole` after `authenticate`:
  INSTALLER tokens (login or scoped) get 403 on every dashboard endpoint —
  routers, plans, sessions, payments, vouchers, portal/payment settings,
  subscription, omada-sites.
- `/api/install/*` requires `authenticate` + `verifyInstallScope`
  (DB revocation/expiry check for `scope='install'` tokens) + per-route
  `requireRole`.
- Scoped tokens (`scope='install'`, claims: jti, tenantId, installationId,
  siteId, scopes) are checked on every request against `installer_tokens` —
  revoked/expired/disabled-installer tokens die in middleware.
- Per-request scope enforcement: a token bound to installation X cannot touch
  installation Y, cannot call tenant-wide endpoints, and installers only see
  installations where `installerId = self`.
- Token issuance: an installer may self-issue for installations assigned to
  them; MERCHANT/SUPER_ADMIN may issue for any tenant installer. All issuance
  and revocation is audited.

### Threat model (scoped tokens)

| Threat | Mitigation |
|---|---|
| Token copied off a stolen laptop/phone | jti revocation + ≤24h TTL + installer `isActive` re-check on every request |
| Token replayed against a different site/installation | `installationId`/`siteId` claims enforced in `gateAction` + `assertTokenScope` |
| Token used for merchant dashboard | `requireDashboardRole` rejects `scope='install'` and `role=INSTALLER` everywhere outside `/api/install` |
| Secrets in tokens | Tokens carry IDs only — no credential material |

## 5. Configuration contract

`src/lib/installation-contract.ts` implements the canonical schema from
`configuration-contract.md`:

- `contractBodySchema` (zod, `.strict()` at root) — customer/site/devices/
  network/wifi/captivePortal/billing/omadaRadius/operations.
- Every value is wrapped `{ value, source, state }` — source vocabulary is a
  closed enum (`INSTALLER`, `CUSTOMER`, `DISCOVERY`, `DERIVED`, `DEFAULT`,
  `ADMIN_DEFINED`, `SYSTEM`, `GEMINI_RECOMMENDED`, `DETERMINISTIC`).
- Secrets appear only as `{ secretRef: "secret://installation/<id>/<sid>" }`.
- Contract versions tracked via `contractVersion` + `revision`; edits while
  DRAFT/IN_PROGRESS invalidate `validatedConfig`.

## 6. Policy validator

`validateContract(raw)`:

1. Zod schema validation (unknown keys/values rejected or stripped-then-scanned).
2. **Inline-secret scan on the RAW input** — zod strips unknown keys silently,
   so the scan runs pre-parse: any string under a credential-looking key that
   isn't a `secretRef` node is rejected with `INLINE_SECRET`.
3. Source-vocabulary sanity.
4. LAN policy: RFC1918 only, ≤/16, no overlap with the reserved control-plane
   range `10.251.0.0/16`, DHCP pool inside subnet and ordered.
5. WAN policy: STATIC requires ip/gateway/dns; PPPOE requires `pppoeRef`
   (inline PPPoE credentials are structurally impossible — there is no
   plaintext field for them).
6. WiFi: only `OPEN_PORTAL` (captive portal model) is supported.
7. Profile whitelist (`TRIVA_BASIC/STANDARD/BUSINESS/CUSTOM`).
8. `dataLimitMb` in plan specs → `UNSUPPORTED_FEATURE` (data caps are not
   enforced by the platform — do not promise them).
9. Identity: `match = MISMATCH|ALREADY_OWNED` inside the contract blocks
   validation (`IDENTITY_BLOCKED`).

`gateAction(entry, ctx)` gates every action: unknown type → `UNKNOWN_ACTION`;
role allowlist → `FORBIDDEN`; tenant mismatch / scoped-token mismatch →
`SCOPE`; terminal installation → `BAD_STATE`; `requiresApproval` without a
matching approval → `APPROVAL_REQUIRED`.

## 7. Action executor — closed vocabulary

`executeActions(installationId, actions, ctx)`:

- Looks up each `type` in `ACTION_REGISTRY`. Not in the registry → `DENIED`.
- In `DECLARED_NOT_IMPLEMENTED` → `NOT_IMPLEMENTED` (honest, not faked).
- Params validated per-action by zod `.strict()` schemas — there is literally
  no string field anywhere that could carry a RouterOS command.
- Scope enforcement: device actions resolve assets through
  `getScopedRouter`/`findAsset` — tenant + site must match the installation.
- Results appended to `installation.executionResults`; every outcome audited
  (`CONFIGURATION_EXECUTED` / `ACTION_DENIED` / `CONFIGURATION_FAILED`).
- Evidence is run through `sanitizeSecrets` before being stored/returned.

### Implemented actions (9)

| Action | What it does |
|---|---|
| `REGISTER_ROUTER` | Creates a MikroTik asset bound to the site (encrypted creds, provisioning key, control-plane IP). |
| `REGISTER_TPLINK_ROUTER` | Same for OpenWrt/TP-Link. |
| `REGISTER_OMADA_SITE` | Omada site asset + FreeRADIUS NAS row (encrypted shared secret). |
| `CLAIM_DEVICE` | Binds an asset to the installation's site after `matchIdentity` passes; `DEVICE_ALREADY_ASSIGNED`/`DEVICE_IDENTITY_MISMATCH`/`NO_IDENTITY_EVIDENCE` deny. |
| `DISCOVER_ROUTER` | Live RouterOS read-back (`getDiscoverySnapshot`) — identity, serial, model, ROS version, interfaces, IPs, DHCP, hotspot servers; persisted to `router.discovery`. |
| `READ_ROUTER_IDENTITY` | Returns the stored bound identity + last discovery snapshot (no network call). |
| `RUN_CONNECTIVITY_TEST` | RouterOS API reachability check for a scoped asset (MIKROTIK/TPLINK). |
| `CONFIGURE_HOTSPOT_PROFILE` | Creates/updates a hotspot user profile (rate-limit) via the existing typed service. |
| `GENERATE_BOOTSTRAP` | Returns the bootstrap URLs for a claimed router — the device pulls and self-configures. |

### Declared but NOT_IMPLEMENTED (return NOT_IMPLEMENTED)

`CONFIGURE_WAN`, `CONFIGURE_LAN`, `CONFIGURE_DHCP`, `CONFIGURE_FIREWALL`,
`CONFIGURE_HOTSPOT` (server creation — bootstrap script requires a pre-existing
hotspot server), `DISCOVER_ACCESS_POINT`, `CONFIGURE_ACCESS_POINT`,
`CONFIGURE_OMADA_CONTROLLER`, `RUN_PORTAL_TEST`, `RUN_PAYMENT_TEST`,
`CONFIGURE_DATA_CAP`.

### Unknown actions

Anything else — `execute_shell`, `routeros_run`, arbitrary command strings —
is `DENIED` as `UNKNOWN_ACTION`. There is no raw-command surface anywhere in
the executor.

## 8. RouterOS discovery/read-back

`MikroTikService.getDiscoverySnapshot()` — allowlisted read ops only
(`/system/identity`, `/system/resource`, `/system/routerboard`,
`/interface`, `/ip/address`, `/ip/dhcp-server`, `/ip/dhcp-server/lease`,
`/ip/hotspot`). Results persisted to `router.discovery`/`discoveredAt` and
surfaced via `DISCOVER_ROUTER`/`READ_ROUTER_IDENTITY`.

Two discovery paths, honestly labeled:

- **Live API read** — works only when the router API is reachable from the
  backend (public IP/port-forward/tunnel). Routers behind CGNAT/NAT without
  forwarding will fail this call.
- **Heartbeat pull** — the bootstrap script now reports `serialNumber`,
  `macAddress`, `model`, `routerOsVersion` on every heartbeat
  (`/bootstrap/heartbeat/:key`). Works behind NAT; first check-in binds
  identity, later mismatches return 409 (existing behavior, now with model/ver).

`bootstrap.controller.ts` sanitizes reported fields (printable ASCII, length
caps) before persisting — device metadata is untrusted input.

## 9. Secret handling

- New writes are encrypted-only: `createMikrotikAsset`/`createTpLinkAsset`
  write `passwordEnc` and leave `passwordHash` empty; `createOmadaSiteAsset`
  writes `radiusSecretEnc` only. (Service factories keep the legacy
  `passwordHash` fallback for rows created before this change.)
- `getBootstrapRouterInfo` no longer returns API credentials — minimum data
  + bootstrap URLs only. The bootstrap *script* still contains the generated
  router API password (the router needs it to self-configure); the script is
  fetched by the router over TLS at bootstrap time, never returned in JSON.
- `getOmadaSite`/list/create no longer return `radiusSecret`/`radiusSecretEnc`.
- `InstallationSecret` values are AES-256-GCM; `secretRef`s are write-only via
  `POST /installations/:id/secrets` — the API never returns a value, only the
  ref. Executor resolves refs internally via `resolveSecretRef` with
  installation pinning.
- `sanitizeSecrets` scrubs audit metadata, executor evidence, and API
  responses (contract reads go through it too).

**Not migrated in this phase:** existing plaintext rows keep working through
the legacy fallback; a data migration to encrypt `passwordHash`/`radiusSecret`
/`anypayApiKey` remnants is P1 (requires the encryption key in scope + a
maintenance window). `webhookSecret` remains plaintext — it IS the credential
(hashed-at-rest would break lookup-by-token); marked for a rotate-to-hash
design in P1.

## 10. Socket.IO tenant isolation

- `io.use` resolves `handshake.auth.token` → `kind: 'user'` (JWT) or
  `kind: 'portal'` (scoped portal token). Unknown/missing → `auth=null`;
  connection allowed (polling fallback survives) but every subscribe denied.
- `portal:subscribe` requires a portal token AND `macAddress` matching the
  token-bound MAC; rooms `mac:<mac>` + `tenant_portal:<tenantId>` come from
  the token — never client input.
- `dashboard:subscribe` joins `tenant:<auth.tenantId>`; client-supplied
  tenantId is ignored for non-admins. SUPER_ADMIN may target a tenant room.
- Portal tokens (`mintPortalSocketToken`) are minted by
  `GET /api/portal/session/:id` (`socketToken` in the response), bound to that
  session's tenant+MAC, 1h TTL. The captive portal fetches status first, then
  connects with `auth:{token}` — polling still works without it.
- Dashboard `socketStore` now sends `auth:{token}` (the login JWT).

**Consequence:** `session:activated` (which carries hotspot credentials to
`mac:<mac>`) can only reach sockets holding a token minted from that exact
session — cross-tenant credential leak closed. Old portal clients that never
fetch session status lose realtime but keep polling.

## 11. New API surface (`/api/install`)

| Method | Path | Roles |
|---|---|---|
| GET | `/capabilities` | INSTALLER, MERCHANT, SUPER_ADMIN |
| POST/GET | `/customers` | all field roles |
| POST/GET | `/sites`, GET `/sites/:id` | all field roles |
| POST/GET | `/installations`, GET `/installations/:id` | all (installers see own only) |
| PUT | `/installations/:id/contract` | all field roles |
| POST | `/installations/:id/validate` | all field roles |
| POST | `/installations/:id/execute` | all field roles |
| POST | `/installations/:id/transition` | all field roles |
| POST | `/installations/:id/diagnostics` | all field roles (allowlisted checks → executor) |
| GET | `/installations/:id/audit` | all field roles |
| POST/GET | `/installations/:id/secrets` | all field roles (write-only values) |
| POST/DELETE | `/installations/:id/tokens[/:jti]` | all field roles |
| POST/GET | `/installers` | MERCHANT, SUPER_ADMIN |
| GET | `/audit` | MERCHANT, SUPER_ADMIN |

## 12. Capability registry

`GET /api/install/capabilities` returns `getCapabilityRegistry(...)` —
generated from real implementation state, including `actions` (implemented
only) and `declaredNotImplemented`. Notable honest falses:

- `mikrotik.wanConfiguration/lanConfiguration/dhcpConfiguration/firewallConfiguration/hotspotConfiguration: false`
- `omada.controllerDiscovery/controllerApiProvisioning/apInventory: false`
- `billing.dataCaps: false`, `billing.refunds: false`
- `installation.llmAssist: false`

## 13. Audit logging

Every sensitive transition writes an `AuditLog` row (sanitized metadata):
installation create/status change/complete/cancel, customer/site create,
device claim/deny/discover, configuration request/validate/reject,
action execute/deny/fail, diagnostic start/fail, secret create/consume,
installer create, token issue/revoke. Audit failures never break the
operation being audited (logged + swallowed).

## 14. Tests added

| File | Coverage |
|---|---|
| `src/lib/__tests__/sanitize.test.ts` | credential redaction, secretRef collapse, array recursion, inline-secret paths |
| `src/services/installation/__tests__/identity.test.ts` | tenant/site ownership, serial+MAC match/mismatch, first binding |
| `src/services/installation/__tests__/policy-validator.test.ts` | valid contract, RFC1918/subnet/pool rules, PPPoE ref requirement, inline-secret rejection, data-cap rejection, bad source, identity block, gateAction role/scope/terminal/approval/unknown-action |
| `src/services/installation/__tests__/executor.test.ts` | shell-command denial, NOT_IMPLEMENTED, malformed requests, cross-tenant/scoped-token/terminal denial, claim deny paths, successful claim+bind, result persistence, secret non-leakage |
| `src/socket/__tests__/socket-auth.test.ts` | portal token resolve, user JWT resolve, bad-token rejection, dashboard room isolation, unauthenticated denial, MAC-binding enforcement |

**Result:** 53/55 unit tests pass. The `auth.test.ts` + DB-gated suites
require a reachable `*_test` Postgres (none running on this machine — docker
unavailable); they are environment-gated, not regressed.

## 15. What is NOT done (P1+)

- **Physical hardware verification** — no real MikroTik/Omada was touched.
  `DISCOVER_ROUTER`/`CONFIGURE_HOTSPOT_PROFILE` are compiled and unit-shaped
  but unproven against RouterOS.
- **WAN/LAN/DHCP/firewall/hotspot-server push** — declared NOT_IMPLEMENTED;
  bootstrap-script pull remains the provisioning mechanism.
- **Omada controller API** — still zero; manual provisioning flow unchanged.
- **Data caps** — schema fields exist, zero enforcement; validator rejects
  contracts that depend on them.
- **Legacy secret migration** — old `passwordHash`/`radiusSecret`/`anypayApiKey`
  plaintext rows remain readable via fallback until a migration runs.
- **Provisioning-key hardening** — bearer-URL model retained for compatibility;
  one-time-token upgrade is P1.
- **Full installer UI** — API exists; no UI built (per scope).
- **Gemini** — not integrated; `llmAssist: false` in the registry.
