# TrivaConnect Copilot — Audit & Specification

## Executive Summary

TrivaConnect today is a **working hosted captive-portal + billing platform**: PostgreSQL/Prisma + Express backend, React merchant dashboard, standalone captive-portal app, and three device integrations (MikroTik pull-sync, TP-Link/OpenWrt pull-sync, Omada external-portal + FreeRADIUS) with AnyPay-only payments. Sessions, vouchers, subscriptions, reconciliation, and expiry all work — verified end-to-end in the isolated deployment.

What it **does not** have is an installation product. Onboarding a site is a sequence of manual operations by a merchant/admin: create a router asset, download an `.rsc`, create a hotspot server yourself, import the script, then (for Omada) hand-configure the controller. There is no installer role, no site model, no device discovery, no config profiles, no diagnostics bundle, and no audit trail — the things a Copilot needs as *its* substrate. Gemini must therefore be added as a **proposal layer over a new deterministic installation engine**, not bolted onto today's screens.

Documents:

- [`current-system-capabilities.md`](./current-system-capabilities.md) — verified capability map (IMPLEMENTED / PARTIAL / PLACEHOLDER / NOT IMPLEMENTED)
- [`auto-discovery.md`](./auto-discovery.md) — every value and whether it's discoverable, entered, derived, or recommended
- [`installation-question-bank.md`](./installation-question-bank.md) — the complete conditional interview, stage by stage
- [`configuration-contract.md`](./configuration-contract.md) — the structured object shared by Copilot ↔ backend ↔ executor
- [`gemini-context-contract.md`](./gemini-context-contract.md) — exactly what enters/leaves the LLM, and the isolation rules
- [`example-new-site-installation.md`](./example-new-site-installation.md) — full NEW CUSTOMER → SITE ONLINE walkthrough incl. failures

---

## Current Installation Flow (what happens today)

**MikroTik:** create tenant + subscription → dashboard "Add Router" (name, serial?, MAC?, hotspotName, location) → backend mints control-plane IP + API creds + provisioningKey → operator downloads Auto Installer `.rsc` → **manually creates hotspot server, transfers + imports script** → router calls `/bootstrap/router/:key` (serial/MAC bound, 409 on mismatch) → 15s pull-sync loop live. Sessions provision via direct RouterOS API with pull-sync fallback.

**Omada:** create `OmadaSite` (controllerUrl, controllerIp, ssidName) → backend generates RADIUS secret + writes `nas` row → operator downloads portal-page package → **manually configures controller** (external portal URL, RADIUS profile, SSID) → clicks "mark provisioned" → client flow: SSID → portal redirect → pay/voucher → 60s single-use token → RADIUS creds.

**What can happen:** full paid-WiFi operation once devices are provisioned. **What can't:** discovery, identity-from-hardware without manual asset pre-creation, WAN/LAN/firewall configuration, controller automation, installer scoping, guided flow, diagnostics, rollback.

## Desired Installation Flow

`Installer → Copilot → (Gemini proposes) → Policy validator → Deterministic executor → Device evidence → Verification → SITE ONLINE`

Eleven stages: CUSTOMER → SITE → HARDWARE → WAN → LAN → WIFI → PORTAL → BILLING → SECURITY → VERIFY → COMPLETE. Gemini asks only what can't be discovered; every value lands in the versioned config contract; device identity binds via MAC/serial evidence (reusing the existing bootstrap binding + 409 logic).

## Gap Analysis

| Missing component | Why it blocks Copilot |
|---|---|
| `Site` + `Installation` models | Nowhere to persist the contract; no resumable installs |
| `INSTALLER` role + scoped tokens | Installers would need full merchant rights today |
| Device discovery (model/RouterOS/WAN/LAN state via RouterOS query; Omada controller API client) | Without it the Copilot must ask technical questions it shouldn't |
| Config profiles (`TRIVA_*`) | Nothing for Gemini to select — it would invent networks |
| Structured action executor | Today execution = "generate script, hope human runs it" |
| Diagnostics bundle | No verification stage exists beyond `pingRouter` |
| Audit/event store | No proposals/approvals/execution trail |
| Encryption-on-write migration | `passwordHash`/`radiusSecret`/`anypayApiKey` still written plaintext in create paths |

## Copilot Questions

Complete conditional bank in [`installation-question-bank.md`](./installation-question-bank.md). Essence: ~15 things actually require a human (business identity, site name/location, purpose, user count, physical confirmations, ISP details only when not discoverable, SSID name, plan confirmation, AnyPay readiness, approvals). Everything else is discovered, defaulted, or derived.

## Automatic Discovery

Full matrix in [`auto-discovery.md`](./auto-discovery.md). Today: serial/MAC binding, observed source IP, heartbeat/last-seen, subscription/plan/tenant state, AnyPay health, portal reachability, RADIUS auth activity. Needed: RouterOS model/version/WAN/LAN/hotspot inventory, Omada controller+AP inventory — all via new structured discovery scripts/API client, all reported as evidence.

## Gemini Responsibilities

Understand installer language; ask the next needed question; recommend SSID/subnet/plans/profile/placement/troubleshooting; explain diagnostics and errors; convert intent into contract proposals; flag uncertainty. **Degraded mode required:** installation must complete with Gemini offline (plain wizard, same contract).

## Deterministic Responsibilities

Schema + policy validation; all secret generation/storage; identity matching (MAC/serial); action planning/ordering; device execution; diagnostic verdicts; approval state; audit persistence; subscription/limit enforcement. Gemini output is untrusted input to all of these.

## Configuration Contract

[`configuration-contract.md`](./configuration-contract.md) — versioned envelope, three snapshots (`requested`/`validated`/`executed`), `source`+`state` tags on every value, `secretRef` for all secrets, closed structured-action vocabulary, diagnostics + rollback + audit sections.

## Security Model

[`gemini-context-contract.md`](./gemini-context-contract.md). Key points: a `sanitizeForGemini()` filter strips every credential class (AnyPay keys, router passwords incl. plaintext `passwordHash`, RADIUS secrets, webhook secrets, JWT secret, DB URL, all `*Enc` ciphertext, session creds, portal tokens); Gemini sees `{secretRef, present:true}`; outputs are schema-validated JSON, fields with forbidden sources stripped, unknown actions rejected; injection attempts logged and ignored; approvals are human-only.

## Required Development Work

### P0 — before any Gemini integration

| # | Item | Complexity |
|---|---|---|
| P0-1 | `Site` + `Installation` + `AuditLog` Prisma models + migrations | LOW |
| P0-2 | `INSTALLER` role + installation-scoped short-lived tokens | MEDIUM |
| P0-3 | Configuration contract schema + policy validator (values, sources, states) | MEDIUM |
| P0-4 | Structured action executor wrapping existing services (`tenant.create` → `diagnostics.run`) | HIGH |
| P0-5 | `secretRef` resolution + encrypt-on-write migration for `passwordHash`/`radiusSecret`/`anypayApiKey` | MEDIUM |
| P0-6 | RouterOS discovery read-back (model/version/interfaces/WAN/LAN/hotspot presence) in bootstrap/sync | MEDIUM |
| P0-7 | Secrets sanitizer for LLM context | LOW |

### P1 — Copilot MVP

| # | Item | Complexity |
|---|---|---|
| P1-1 | Copilot orchestrator (stage machine, question bank driver, degraded wizard fallback) | HIGH |
| P1-2 | Copilot installer UI (mobile-first: scan, confirm, approve) | HIGH |
| P1-3 | Gemini adapter (context builder → call → output validator) | MEDIUM |
| P1-4 | `TRIVA_*` config profiles | LOW |
| P1-5 | Diagnostics bundle (WAN/outbound/portal/RADIUS/test-session) | MEDIUM |
| P1-6 | WAN/LAN/hotspot structured configuration actions on MikroTik | HIGH |
| P1-7 | Barcode/photo → MAC/serial capture | MEDIUM |
| P1-8 | Device ownership/reassignment workflow | MEDIUM |

### P2 — future improvements

| # | Item | Complexity |
|---|---|---|
| P2-1 | Omada SDN OpenAPI client (AP inventory, SSID/portal/RADIUS push) | HIGH |
| P2-2 | True zero-touch MikroTik (setup SSID / netinstall / RouterOS REST self-bootstrap) | VERY HIGH |
| P2-3 | Config snapshot + rollback | HIGH |
| P2-4 | Fleet monitoring + offline alerts/notifications | MEDIUM |
| P2-5 | Data-limit enforcement (`dataLimitMb` + `bytesIn/Out` accounting) | MEDIUM |
| P2-6 | Free/trial/OTP portal modes | MEDIUM |
| P2-7 | GPS site capture, RF/coverage guidance | MEDIUM |
| P2-8 | Refunds, receipts | MEDIUM |

## Architectural Risks Found During Audit

1. **Plaintext credential writes** — `Router.passwordHash`, `TpLinkRouter.passwordHash`, `Tenant.anypayApiKey`, `OmadaSite.radiusSecret` still populated alongside `*Enc` fields; `getBootstrapRouterInfo` returns `apiPassword` (the plaintext `passwordHash`) to anyone holding the provisioning key. Must be resolved before an installer-facing surface multiplies exposure.
2. **Provisioning key = bearer credential in a URL** — bootstrap/heartbeat/sync keyed by path token (in logs, browser history, referrer). Needs rotation/expiry + per-device nonce for Copilot use.
3. **Socket.IO rooms unauthenticated** — any client can `portal:subscribe`/`dashboard:subscribe` to any `tenantId`/MAC room and receive `session:activated` events (which include hotspot credentials). Needs auth handshake before Copilot adds more event types.
4. **No tenant↔device collision UX** — serial/MAC unique constraints throw raw errors; the Copilot needs an explicit `ALREADY_OWNED` flow.
5. **Single-process backend runs API + Socket.IO + all jobs** — fine now, but Copilot adds long-running install sessions; job extraction will eventually be needed.
6. **`dataLimitMb`/`bytesIn·Out` fields exist but are unenforced/unpopulated** — don't promise data-capped plans in the interview until built.
7. **Dashboard "Auto Installer/zero-touch" naming** overstates current behavior — Copilot specs must not inherit the assumption.

## The Direct Answer

> *Installer at a new site, factory-default MikroTik + Omada EAP — what must TrivaConnect collect, discover, ask, and execute?*

**Collect (human-provided, ~11 items):** business name, contact name, phone, login email, site name, location, purpose, expected users, AP count, SSID choice, plan-set confirmation — plus conditional items: WAN credentials only if static/PPPoE, AnyPay readiness, support contact, install notes.

**Discover automatically:** serial + MAC (bootstrap binding — existing), observed WAN IP, outbound reachability, online/last-seen; *with new work:* model, RouterOS version, WAN type/state, existing LAN/hotspot config, Omada controller reachability + AP inventory, RADIUS auth evidence, AnyPay health, portal fetch, subscription/router-slot limits.

**Gemini asks/recommends:** next question selection, SSID, LAN subnet (from allowlist), plan set, profile choice, branding text, troubleshooting explanations and ordering — all `GEMINI_RECOMMENDED`, all backend-validated, all approval-gated.

**Deterministic execution (never Gemini):** tenant+site creation, all credential generation/storage (`secretRef`), identity matching (MAC/serial), subnet/DHCP derivation, firewall baseline, walled-garden list, hotspot provisioning, RADIUS secret + NAS registration, portal pages/tokens, plan persistence, payment handling, diagnostics verdicts, approval state, audit logging, and the final "site ACTIVE" transition.
