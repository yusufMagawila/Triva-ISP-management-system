# TrivaConnect Copilot — Automatic Discovery Specification

Purpose: define **which configuration values TrivaConnect can obtain without asking the installer**, which need installer input, which the customer must supply, and which are not discoverable today. This drives the question bank — the Copilot must never ask for something the system can discover.

**Critical caveat (verified):** the current backend has **no active discovery mechanism**. It cannot scan a LAN, listen for MNDP, or call an unconfigured router. All discovery today is **inbound**: the device calls Triva (bootstrap/heartbeat/sync/RADIUS auth) carrying identity data. The "Method" column below distinguishes what works *today* from what requires new capability.

Method tags:
- `[NOW]` — works in the current codebase.
- `[PULL]` — works today but only after the router runs the bootstrap script once.
- `[NEW]` — requires new implementation (see README gap analysis).
- `[INSTALLER]` — installer's eyes/hands on site; fed through Copilot UI (e.g. barcode photo).

---

## 1. MikroTik device identity & state

| Field | Source | Method | Trust? | Installer input? | Validation |
|---|---|---|---|---|---|
| `serialNumber` | RouterOS `/system routerboard` → reported via bootstrap query param | `[PULL]` bootstrap call `?serialNumber=` | YES (bound once; mismatch → 409) | No (after bootstrap) / optional pre-bind | Normalized via `normalizeRouterSerial`; `@unique` |
| `hardwareMac` | RouterOS → bootstrap query param | `[PULL]` `?macAddress=` | YES (same binding rule) | No / optional pre-bind | `normalizeRouterMac`; `@unique` |
| `routerModel` | RouterOS `routerboard model` | `[NEW]` — not captured today (no schema column) | YES once collected | No | Match against known RouterBOARD list |
| `routerOsVersion` | RouterOS `/system resource` | `[NEW]` — not captured today | YES once collected | No | Minimum supported version check (e.g. ≥7.x for `fetch`+scheduler syntax used by installer script) |
| `lastBootstrapIp` (observed WAN-side source IP) | HTTP request source / `X-Forwarded-For` | `[NOW]` `getRequestIp` in bootstrap controller | YES as *observed* IP | No | — |
| `online` / `lastSeenAt` | Heartbeat + sync calls | `[NOW]` | YES | No | status=ONLINE on successful call |
| `provisioningKey` knowledge | URL path | `[NOW]` | YES — possession = bootstrap credential | No | Lookup + optional identity check |
| Control-plane IP (`10.251.x.x`) | Backend-generated | `[NOW]` | YES (assigned by us) | No | Uniqueness within allocation scheme |
| Hotspot server existence (`hotspotName`) | RouterOS `/ip hotspot print` | `[NEW]` — installer script currently *fails* telling operator to create it manually | YES once queried | No (should be queried, not asked) | Name match vs configured `hotspotName` |
| WAN link state / IP | RouterOS `/ip address`, `/ip dhcp-client` | `[NEW]` — needs a diagnostic script added to bootstrap/sync output | YES once queried | No | Valid IP on WAN interface |
| LAN subnet / DHCP pool actually configured | RouterOS `/ip address`, `/ip pool`, `/ip dhcp-server` | `[NEW]` | YES once queried | No | CIDR parse; conflict check vs Triva control-plane range `10.251.0.0/16` |
| Internet reachability from router | RouterOS `fetch`/`ping` to `APP_URL` | `[PARTIAL]` — bootstrap succeeding *is* the proof of outbound HTTPS reachability | YES | No | Bootstrap call received = WAN works outbound |
| Active hotspot users / DHCP leases | RouterOS API | `[PARTIAL]` — API exists in `MikroTikService` but only used for session ops, not discovery | YES | No | — |
| Barcode/label MAC (box label) | Installer's phone camera | `[INSTALLER]` `[NEW]` — no scanning exists | NO until matched — must be confirmed against bootstrap-reported MAC | Yes (photo/typing) | Exact MAC equality after normalization |

**Identity rule (deterministic, already in code):** a scanned/typed MAC or serial is only *bound* when the router's own bootstrap call reports the same value. Scanned value = claim; reported value = evidence. Never let Gemini or installer text override the reported binding.

## 2. Omada / EAP

| Field | Source | Method | Trust? | Installer input? | Validation |
|---|---|---|---|---|---|
| `controllerIp` / `controllerUrl` | Installer measurement or controller UI | `[INSTALLER]` today; `[NEW]` if we add controller API client | Partial — validate by RADIUS probe | Yes | URL/IP format; reachability check `[NEW]` |
| RADIUS auth requests arriving | FreeRADIUS sees NAS client | `[NOW]` (updates `OmadaSite.lastSeenAt`) | YES | No | Source IP matches `controllerIp` |
| Controller version/site list/AP list | Omada SDN OpenAPI | `[NEW]` — no Omada API client exists | YES once integrated | No | Controller API auth |
| EAP model / MAC / firmware | Omada controller API or device label | `[NEW]` (controller) / `[INSTALLER]` (label) | Controller-reported YES; label = claim | Label: yes | Match controller-reported AP list |
| Client MAC + AP + SSID on redirect | Omada portal redirect params | `[NOW]` — redirect carries client metadata consumed by `getOmadaPortalInfo` | YES | No | — |
| SSID actually configured | Omada controller API | `[NEW]` | YES once integrated | No | Equality vs desired SSID |
| EAP powered & adopted | Physical LED / controller adoption state | `[INSTALLER]` physical / `[NEW]` controller API | Controller YES | Yes (physical check) | — |

## 3. Triva backend / tenant state (free context — never ask)

| Field | Source | Method | Trust | Installer input? | Validation |
|---|---|---|---|---|---|
| Tenant name/email/phone/address/branding | `Tenant` row | `[NOW]` | YES | No | Existing validation |
| Subscription plan + expiry + remaining router slots | `Subscription` + `config/plans.ts` limits | `[NOW]` | YES | No | `getPlanConfig` |
| Existing plans (prices/durations/limits) | `Plan` rows | `[NOW]` | YES | No | — |
| Existing devices (serial/MAC uniqueness, ownership) | `Router`/`TpLinkRouter`/`OmadaSite` | `[NOW]` | YES | No | `@unique` + tenant match |
| AnyPay configured & enabled | `Tenant.anypayApiKeyEnc`/platform `PlatformSetting` | `[NOW]` | YES | No | Presence + enabled flag; live test via `payment-settings/test` endpoint `[NOW]` |
| Active sessions / today’s count vs daily cap | `Session` rows | `[NOW]` | YES | No | — |
| Portal reachability | `GET /health`, `PORTAL_URL` fetch | `[NOW]` server-side | YES | No | HTTP 200 |
| Voucher stock | `Voucher` rows | `[NOW]` | YES | No | — |

## 4. Installer-must-provide (cannot be discovered)

| Field | Why not discoverable |
|---|---|
| Customer/business name, contact person, phone, email | Business data — not on the wire |
| Site name, physical address/GPS | Free-text `location` exists but nothing populates it |
| Installation purpose (hotspot billing vs staff WiFi etc.) | Intent |
| Expected concurrent users / coverage expectation | Intent — feeds plan/profile recommendation only |
| WAN provider & connection type **if not yet connected** | Once connected, DHCP/PPPoE state is discoverable via RouterOS `[NEW]`; before that, ask |
| Static WAN IP/gateway/DNS (if ISP provided) | Cannot be guessed — must be typed or read from ISP paperwork |
| Physical confirmations (cable in WAN port, AP powered, antenna placement) | Physical world |
| AnyPay merchant onboarding state ("do you have an AnyPay account?") | External business relationship |
| SSID display name preference | Customer branding choice — Gemini may *suggest* from business name |
| Pricing decision (which plans to sell) | Business decision — Gemini recommends, merchant confirms |
| Approval to execute each irreversible/config-writing step | Human-in-the-loop requirement |

## 5. Derivable (installer never asked — computed deterministically)

| Field | Derivation |
|---|---|
| `controlPlaneIp` | Backend allocation (current `10.251.x.x` scheme) |
| Router API username/password, `provisioningKey`, RADIUS `radiusSecret`, per-session hotspot credentials, `OmadaPortalToken` | Server-generated randomness — **DETERMINISTIC/SECRET, never Gemini, never installer-visible** |
| DHCP pool range | Derived from confirmed LAN subnet by deterministic rule (e.g. `.100–.254`) |
| Hotspot user profile names (`plan_<id8>`) | Existing convention in `session.service.ts` |
| Webhook URLs | `APP_URL` + generated secret path — never typed by installer |
| Portal URLs per router | `PORTAL_URL` + `routerId` — derived |
| `hotspotName` default | `hotspot1` (schema default) — only ask if discovery finds a different existing server |

## 6. Gemini-recommendable (suggest, never decide)

SSID name, LAN subnet choice (from allowlisted private ranges, collision-checked against discovery), plan set suggestion (from customer type + expected users), placement/coverage hints, troubleshooting next-step suggestions, explanation of any diagnostic result. All subject to backend validation — see `gemini-context-contract.md`.

## 7. Not discoverable by current system (hard gaps)

- Router model / RouterOS version (no capture column, no query)
- Whether the physical WAN cable is plugged in (only inferable once DHCP/static state is queried `[NEW]`)
- Omada controller software version, AP inventory, SSID state (no API client)
- Whether the installer is physically at the site (no geofence/attestation)
- Factory-default vs previously-configured router (can be *detected* via `[NEW]` RouterOS query for existing config; not today)
- Signal coverage / RF survey — fully out of scope for software discovery
