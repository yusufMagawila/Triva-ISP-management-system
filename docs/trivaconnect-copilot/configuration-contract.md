# TrivaConnect Copilot — Structured Configuration Contract

This document defines the JSON object exchanged between the **Copilot (conversation layer)**, the **backend (validation layer)**, and the **deterministic configuration engine (execution layer)**. It is the single artifact all three sides speak.

**Design rules (binding):**

1. The object is data, not instructions. It never contains RouterOS commands, shell, or credentials.
2. Every value carries a `source` and a `state` so the system always knows who proposed it and whether it's authoritative.
3. Secrets are **references** (`secretRef`), never values. Gemini never sees a plaintext secret; the executor resolves references internally.
4. Three snapshots exist: `requested` (what Gemini proposed), `validated` (what backend accepted after policy), `executed` (what the device actually confirmed). They must be diffable.
5. The whole object is versioned and idempotent — re-submitting the same `installationId`+`revision` is a no-op.

---

## 1. Envelope

```jsonc
{
  "contractVersion": "1.0",              // semver of this schema
  "installationId": "cuid",              // server-generated at first save; stable across the whole flow
  "revision": 7,                          // monotonic; optimistic-concurrency key
  "idempotencyKey": "installer-device-uuid + attempt-nonce",
  "tenantId": "cuid | null",             // null until customer stage completes
  "createdBy": { "userId": "cuid", "role": "INSTALLER" },
  "createdAt": "iso8601",
  "updatedAt": "iso8601",

  "stage": "CUSTOMER|SITE|HARDWARE|WAN|LAN|WIFI|PORTAL|BILLING|SECURITY|VERIFY|COMPLETE",
  "approval": {
    "state": "DRAFT|PENDING_INSTALLER_CONFIRM|PENDING_ADMIN|APPROVED|REJECTED",
    "approvals": [
      { "step": "mikrotik-bootstrap", "by": "userId", "at": "iso8601", "method": "tap-confirm" }
    ]
  },
  "state": {
    "requested":  { /* section 2 — Gemini/installer proposal */ },
    "validated":  { /* same shape, populated by policy validator */ },
    "validationErrors": [
      { "path": "network.lan.subnet", "code": "SUBNET_CONFLICT", "message": "Overlaps 10.251.0.0/16 control-plane range" }
    ],
    "executed":   { /* same shape, written back from device evidence */ }
  },
  "execution": {
    "plan":      [ /* section 4 — ordered structured actions */ ],
    "results":   [ { "actionId": "a3", "status": "OK|FAILED|SKIPPED", "evidence": {}, "error": null } ],
    "rollback":  { "available": true, "snapshotRef": null, "steps": [] },
    "diagnostics": [ /* section 5 */ ]
  },
  "audit": {
    "log": [ { "at": "iso8601", "actor": "user|system|gemini", "event": "proposal|validation|approval|execution|error", "detailRef": "auditLogId" } ]
  }
}
```

## 2. Configuration body (`requested` / `validated` / `executed`)

```jsonc
{
  "customer": {
    "businessName":  { "value": "ABC Shop",        "source": "INSTALLER",   "state": "CONFIRMED" },
    "contactPerson": { "value": "Neema",            "source": "INSTALLER",   "state": "CONFIRMED" },
    "phone":         { "value": "+255712000000",    "source": "INSTALLER",   "state": "CONFIRMED", "validation": "e164-tz" },
    "email":         { "value": "abc@shop.co.tz",   "source": "INSTALLER",   "state": "PROPOSED" },
    "address":       { "value": "Sinza, Dar es Salaam", "source": "INSTALLER", "state": "CONFIRMED" }
  },

  "site": {
    "siteId":            "cuid | null",            // NEW MODEL REQUIRED — see §7
    "name":            { "value": "ABC Shop — Main", "source": "DERIVED", "state": "CONFIRMED" },
    "location":        { "value": "-6.77,39.22 | text", "source": "INSTALLER|GPS", "state": "CONFIRMED" },
    "expectedUsers":   { "value": 30,               "source": "INSTALLER",   "state": "CONFIRMED" },
    "profile":         { "value": "TRIVA_STANDARD", "source": "GEMINI_RECOMMENDED", "state": "CONFIRMED",
                         "allowed": ["TRIVA_BASIC","TRIVA_STANDARD","TRIVA_BUSINESS","CUSTOM"] },
    "coverage":        { "value": "indoor", "source": "INSTALLER", "state": "CONFIRMED" }
  },

  "devices": {
    "mikrotik": {
      "assetId":    "cuid | null",                 // existing Router row once created
      "identity": {
        "scannedMac":      { "value": "DC:2C:6E:...", "source": "INSTALLER",   "state": "CLAIM" },
        "scannedSerial":   { "value": "HEX...",        "source": "INSTALLER",   "state": "CLAIM" },
        "reportedMac":     { "value": "DC:2C:6E:...", "source": "DISCOVERY",   "state": "VERIFIED" },
        "reportedSerial":  { "value": "HEX...",        "source": "DISCOVERY",   "state": "VERIFIED" },
        "model":           { "value": "hAP ac2",       "source": "DISCOVERY",   "state": "VERIFIED" },
        "routerOsVersion": { "value": "7.15.2",        "source": "DISCOVERY",   "state": "VERIFIED" },
        "observedSourceIp":{ "value": "197.x.x.x",     "source": "DISCOVERY",   "state": "VERIFIED" },
        "match":           { "value": "MATCHED",       "source": "SYSTEM",      "state": "VERIFIED",
                             "allowed": ["UNMATCHED","MATCHED","MISMATCH","ALREADY_OWNED"] }
      },
      "role":     { "value": "gateway+hotspot", "source": "DETERMINISTIC", "state": "CONFIRMED" },
      "hotspotName": { "value": "hotspot1", "source": "DEFAULT", "state": "CONFIRMED" },
      "controlPlaneIp": { "value": "10.251.0.7", "source": "DERIVED", "state": "CONFIRMED" },
      "credentials": {
        "apiUserRef":      { "secretRef": "vault://install/<id>/mikrotik-api-user" },
        "apiPasswordRef":  { "secretRef": "vault://install/<id>/mikrotik-api-pass" },
        "provisioningKeyRef": { "secretRef": "vault://install/<id>/prov-key" }
      }
    },

    "omada": {
      "siteAssetId": "cuid | null",                // OmadaSite row
      "controllerUrl":  { "value": "https://192.168.88.10", "source": "INSTALLER|DISCOVERY", "state": "CONFIRMED" },
      "controllerIp":   { "value": "192.168.88.10", "source": "INSTALLER|DISCOVERY", "state": "CONFIRMED" },
      "accessPoints": [
        {
          "labelMac":    { "value": "B8:4D:...", "source": "INSTALLER", "state": "CLAIM" },
          "reportedMac": { "value": "B8:4D:...", "source": "DISCOVERY", "state": "VERIFIED" },
          "model":       { "value": "EAP225",    "source": "DISCOVERY", "state": "VERIFIED" },
          "adopted":     { "value": true,        "source": "DISCOVERY", "state": "VERIFIED" },
          "match":       { "value": "MATCHED",   "source": "SYSTEM",    "state": "VERIFIED" }
        }
      ],
      "credentials": {
        "controllerAuthRef": { "secretRef": "vault://install/<id>/omada-ctrl" },
        "radiusSecretRef":   { "secretRef": "vault://install/<id>/radius-secret" }
      }
    }
  },

  "network": {
    "wan": {
      "type":   { "value": "DHCP|STATIC|PPPOE", "source": "DISCOVERY|INSTALLER", "state": "CONFIRMED" },
      "static": { "value": { "ip": null, "gateway": null, "dns": [] }, "source": "INSTALLER", "state": "PROPOSED" },
      "pppoeRef": { "secretRef": "vault://install/<id>/pppoe" },          // PPPoE user/pass never inline
      "reachability": { "value": "CONFIRMED|FAILED|UNKNOWN", "source": "DISCOVERY", "state": "VERIFIED" }
    },
    "lan": {
      "subnet":   { "value": "192.168.88.0/24", "source": "GEMINI_RECOMMENDED|DEFAULT", "state": "CONFIRMED", "validation": "cidr,rfc1918,no-conflict:10.251.0.0/16" },
      "dhcpPool": { "value": "192.168.88.100-192.168.88.254", "source": "DERIVED", "state": "CONFIRMED" },
      "dns":      { "value": ["1.1.1.1","8.8.8.8"], "source": "DEFAULT", "state": "CONFIRMED" },
      "nat":      { "value": true, "source": "DEFAULT", "state": "CONFIRMED" }
    },
    "firewallProfile": { "value": "TRIVA_BASELINE", "source": "ADMIN_DEFINED", "state": "CONFIRMED",
                         "allowed": ["TRIVA_BASELINE"] },                       // only one until more are defined
    "vlans":           { "value": [], "source": "INSTALLER", "state": "PROPOSED" }
  },

  "wifi": {
    "ssid":       { "value": "ABC Shop WiFi", "source": "GEMINI_RECOMMENDED", "state": "CONFIRMED", "validation": "len<=32" },
    "hidden":     { "value": false, "source": "DEFAULT", "state": "CONFIRMED" },
    "security":   { "value": "OPEN_PORTAL", "source": "DETERMINISTIC", "state": "CONFIRMED",
                    "allowed": ["OPEN_PORTAL"] },                            // captive-portal model forces open+portal
    "clientIsolation": { "value": true,  "source": "ADMIN_DEFINED", "state": "CONFIRMED" },
    "band":       { "value": "2.4+5", "source": "DEFAULT", "state": "CONFIRMED" }
  },

  "captivePortal": {
    "enabled":  { "value": true, "source": "DETERMINISTIC", "state": "CONFIRMED" },
    "mode":     { "value": "MIKROTIK_HOTSPOT|OMADA_EXTERNAL", "source": "DETERMINISTIC", "state": "CONFIRMED" },
    "portalUrl": { "value": "https://portal.trivaconnect.site", "source": "DERIVED", "state": "CONFIRMED" },
    "walledGarden": { "value": ["trivaconnect.site","*.trivaconnect.site","anypaytanzania.com","*.anypaytanzania.com"],
                      "source": "ADMIN_DEFINED", "state": "CONFIRMED" },
    "branding": { "value": { "noticeName": "ABC Shop", "message": "Karibu! Buy a package to connect.", "color": "#2563eb" },
                  "source": "INSTALLER|GEMINI_RECOMMENDED", "state": "CONFIRMED" }
  },

  "billing": {
    "enabled": { "value": true, "source": "DETERMINISTIC", "state": "CONFIRMED" },
    "provider": { "value": "ANYPAY", "source": "DETERMINISTIC", "state": "CONFIRMED", "allowed": ["ANYPAY","VOUCHER"] },
    "credentialRef": { "secretRef": "vault://tenant/<tenantId>/anypay" },   // resolved server-side only
    "plans": {
      "value": [
        { "name": "1 Hour",  "priceTZS": 500,  "durationMins": 60,   "downloadKbps": 5120,  "uploadKbps": 2048,  "dataLimitMb": null },
        { "name": "1 Day",   "priceTZS": 1000, "durationMins": 1440, "downloadKbps": 10240, "uploadKbps": 5120,  "dataLimitMb": null },
        { "name": "1 Week",  "priceTZS": 5000, "durationMins": 10080,"downloadKbps": 10240, "uploadKbps": 5120,  "dataLimitMb": null }
      ],
      "source": "GEMINI_RECOMMENDED", "state": "CONFIRMED",
      "validation": "price>0; durationMins>0; kbps>0|null"
    },
    "vouchersEnabled": { "value": true, "source": "INSTALLER", "state": "CONFIRMED" }
  },

  "omadaRadius": {
    "radiusSecretRef": { "secretRef": "vault://install/<id>/radius-secret" },
    "tokenTtlSeconds": { "value": 60, "source": "ADMIN_DEFINED", "state": "CONFIRMED" },
    "nasRegistered":   { "value": true, "source": "SYSTEM", "state": "VERIFIED" }
  },

  "operations": {
    "monitoring":     { "value": true, "source": "DEFAULT", "state": "CONFIRMED" },
    "supportContact": { "value": "+255...", "source": "INSTALLER", "state": "CONFIRMED" },
    "installerNotes": { "value": "...", "source": "INSTALLER", "state": "PROPOSED" }
  }
}
```

### `source` vocabulary (closed enum)

| Source | Meaning | May Gemini write `value`? |
|---|---|---|
| `INSTALLER` | Typed/spoken by installer | Gemini may transcribe, must preserve |
| `CUSTOMER` | Provided by the business owner | same |
| `DISCOVERY` | Observed from device/network evidence | **NO — read-only to Gemini** |
| `DERIVED` | Computed by deterministic backend rule | **NO** |
| `DEFAULT` | Platform default from profile | **NO** |
| `ADMIN_DEFINED` | Platform policy; installer can't override | **NO** |
| `SYSTEM` | Set by backend (IDs, match results) | **NO** |
| `GEMINI_RECOMMENDED` | Gemini proposal pending validation | YES — the only source it may set |
| `DETERMINISTIC` | Non-negotiable system value | **NO** |

### `state` vocabulary

`PROPOSED` → `CONFIRMED` (installer accepted) → `VERIFIED` (device/system evidence agrees). `CLAIM` = installer-asserted identity awaiting device confirmation. `REJECTED` = failed validation.

## 3. Deterministic identity matching (binding rule)

`devices.*.identity.match` is computed **only** by the backend:

```
MATCHED        = scannedMac == reportedMac OR scannedSerial == reportedSerial (normalized)
MISMATCH       = both present, not equal → BLOCK; installer must re-scan or select another asset
ALREADY_OWNED  = reported serial/MAC bound to Router/TpLinkRouter row of another tenant → BLOCK
UNMATCHED      = nothing scanned yet
```

This mirrors the existing bootstrap behavior (`bootstrap.controller.ts` serial/MAC binding + 409 on mismatch) — the Copilot reuses it, never reimplements it.

## 4. Execution plan — structured actions only

The configuration engine consumes `state.validated` and emits an **ordered action list**. Gemini never emits these directly; it may propose `desiredActions` which the planner maps to this closed set:

| Action type | Maps to existing code |
|---|---|
| `tenant.create` | `admin.controller.ts` tenant creation |
| `plan.bulkCreate` | `plan.controller.ts` `createPlan` × n |
| `mikrotik.assetCreate` | `router.controller.ts` `createRouter` |
| `mikrotik.emitInstallerScript` | `buildRouterSetupInstaller` — returns artifact, installer applies |
| `mikrotik.awaitBootstrap` | Wait for `/bootstrap/router/:key` call w/ identity binding (timeout → recovery flow) |
| `mikrotik.wanConfigure` | **NEW** — structured WAN action (dhcp/static/pppoe) rendered to RouterOS |
| `mikrotik.lanConfigure` | **NEW** — subnet/pool/DNS/NAT |
| `mikrotik.hotspotEnsure` | **NEW** — create hotspot server if discovery found none |
| `omada.siteCreate` | `omada-site.controller.ts` `createOmadaSite` |
| `omada.radiusRegister` | `radius.service.ts` NAS upsert |
| `omada.portalPageEmit` | `downloadPortalPage` artifact |
| `omada.controllerConfigure` | **NEW** — needs Omada OpenAPI client; until then emits manual checklist |
| `portal.brandingSet` | `portal-settings.controller.ts` |
| `voucher.batchCreate` | `voucher.controller.ts` |
| `diagnostics.run` | **NEW** — WAN IP, outbound HTTPS, portal fetch, RADIUS probe, test session |
| `install.finalize` | Persist installation record, mark site ACTIVE |

**Forbidden:** `routeros.raw`, `shell.exec`, `sql.exec`, free-form `command` fields. Any unrecognized action type → validation failure.

Each action is `{ "actionId", "type", "params", "requiresApproval", "rollbackAction", "timeout" }`. Execution writes `execution.results[]` with device-returned evidence.

## 5. Diagnostics schema

```jsonc
{ "id": "d1", "check": "WAN_IP|OUTBOUND_HTTPS|PORTAL_FETCH|RADIUS_AUTH|HOTSPOT_ACTIVE|TEST_SESSION",
  "status": "PASS|FAIL|SKIP", "evidence": { "ip": "...", "latencyMs": 120 },
  "remediationHint": "non-secret hint for Copilot" }
```

Gemini may *explain* and *order* diagnostics; it may not mark them passed — only device evidence does.

## 6. Secret references

`secretRef: "vault://<scope>/<id>"` — resolved only inside the backend executor (backed by `lib/crypto.ts` encrypted columns today, a secrets manager later). Gemini context replaces every `secretRef` node with `{ "secretRef": "…", "present": true }` — see `gemini-context-contract.md`.

## 7. Required new models (gap)

This contract implies two models that **do not exist today**:

- `Site` — groups devices + holds location/contact per physical premises.
- `Installation` (or `InstallSession`) — persists this contract: `installationId`, `revision`, stage, the three state snapshots, approvals, execution results, installer userId.

Without them the contract is a transient payload, not a resumable installation. Both are P0 in the README plan.
