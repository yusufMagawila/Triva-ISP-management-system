# Phase 5B — Real Hardware Provisioning & Validation

> **Purpose.** Prove the deterministic installation engine against real physical
> hardware — no mocks for discovery or hardware behavior. This document records
> what was physically tested, what was code-tested only, what is unsupported,
> and every failure observed with its cause.
>
> **Status: MikroTik path VERIFIED end-to-end on real hardware (with two real
> bugs found and fixed). Omada NOT tested — device was not present.**

---

## 1. Hardware

| Item | Value |
|---|---|
| Exact MikroTik model | **hAP ac lite — RB952Ui-5ac2nD, revision r2** |
| Serial | `F43E0FEFA14C` |
| RouterOS | **6.49.12 (stable)**, build Jan/22/2024 |
| Factory software | 6.44.5 · Current firmware 6.48.6 · Upgrade 6.49.12 |
| CPU / RAM / Flash | MIPS 24Kc 650 MHz (1 core) / 64 MB / 16 MB |
| Architecture | mipsbe |
| Interface MACs | ether1 `DC:2C:6E:C9:D9:B0`, ether2 `…B1`, ether3 `…B2`, ether4 `…B3`, ether5 `…B4`, wlan1 `…B6`, wlan2 `…B5`, bridge `…B1` |
| IP addresses | `192.168.88.1/24` (bridge), `192.168.1.199/24` (ether1, WAN DHCP) |
| Management ports | SSH 22, Telnet 23, HTTP 80, Winbox 8291, API 8728, API-SSL 8729 — all open; HTTPS 443 closed; **no `/rest` (v6 — expected)** |
| Factory credentials | `admin` + **blank password** (after reset) |
| WiFi factory state | wlan1 `MikroTik-C9D9B6` (2.4GHz), wlan2 `MikroTik-C9D9B5` (5GHz), **open — no password**, security profile `none` |
| Exact Omada model | **NOT AVAILABLE — no Omada EAP was present or reachable** |
| Test client | LG phone (`LG-style3`), randomized MAC `5A:1D:B3:27:02:CF` |

> Identity note for the report: the router's IP resolves to `DC:2C:6E:C9:D9:B1`
> at L2 (the bridge/ether2 MAC), while discovery reports `…B0` (ether1). Both
> are legitimate device MACs; the serial `F43E0FEFA14C` is the authoritative
> identity anchor.

## 2. Actual topology used

```
INTERNET
   │
   ▼
Home router (192.168.1.1, WiFi)
   │                         │
   │ ether1 (WAN DHCP        │ WiFi (PC uplink, metric 55)
   │  192.168.1.199)         │
   ▼                         ▼
┌──────────────┐      ┌────────────────┐
│  MikroTik    │      │ Dev PC         │
│  hAP ac lite │      │ 192.168.88.254 │──┐ Ethernet (metric 75,
│  192.168.88.1│◄─────│ (bypassed      │  │  no default route
└──────┬───────┘      │  mgmt host)    │  │  → WiFi stays primary)
       │ bridge       └────────────────┘  │
       │ 192.168.88.0/24                  │
       ▼                                  │
   wlan1/2 (open)                         │
       │                                  │
       ▼                                  │
   Test phone                     heartbeat/sync
   192.168.88.253                 target: dev PC :8787
   (captive client)               (local HTTP server)
```

**Dual-homing fix (required for the lab):** Windows prefers Ethernet (metric 5)
over WiFi (55) for the default route → all traffic died into the MikroTik. Fix:
`Set-NetIPInterface -InterfaceAlias Ethernet -InterfaceMetric 75`. WiFi keeps
the internet route; `192.168.88.0/24` stays reachable over Ethernet.

A Windows firewall inbound rule (`New-NetFirewallRule -LocalPort 8787`) was
needed so the router could `/tool fetch` the bootstrap from the dev machine.

## 3. MikroTik results

| Test | Result | Notes |
|---|---|---|
| Discovery | **PASS** | Real `getDiscoverySnapshot` over API 8728 — identity, model, serial, RouterOS, interfaces+MACs, IPs, DHCP server+leases, hotspot list. First connect ~430–1280ms, warm ~76ms. |
| Identity | **PASS (after fix)** | `matchIdentity` now normalizes the stored side — bug #1 below. |
| Claim | **PASS** | MATCHED / MISMATCH / ALREADY_OWNED (same + cross-tenant) all correct. |
| Read-back | **PASS** | Re-read snapshots are deterministic; post-write reads confirmed every change. |
| Bootstrap | **PASS (after fix)** | Router `/tool fetch`+`/import` succeeded; `triva-agent` user, walled-garden (7+4 entries), `triva-heartbeat`+`triva-sync` scripts+schedulers created; **idempotent re-import**; **survives reboot, resumes autonomously**. Bug #2 below fixed. |
| Hotspot | **PASS (with caveat)** | Server created via `/ip hotspot add` (65ms); `createOrUpdateProfile` write+read-back verified (create 173ms, idempotent update 111ms). Caveats #4–#6 below are real. |
| Connectivity | **PASS** | `testConnection` 70ms; WAN verified by router-side ping 8.8.8.8 (~110–450ms). `testConnection` collapses error types — finding #3. |
| Portal | **PASS** | Phone captive → `rlogin.html` served → login form → auth → status. Portal file delivery verified. rlogin finding #6. |
| Payment | **NOT TESTED** | No running backend/DB or AnyPay test credentials. The *mechanism* a payment would trigger (sync → MAC-bound hotspot user → auth) was verified with a simulated session. |
| Expiration | **PASS** | Sync-driven removal: kicked `active` session + removed user → phone captive again within one 15s sync interval. `limit-uptime` mid-session does NOT evict (finding #7) — sync removal is the correct path and works. |
| Heartbeat | **PASS** | Scheduled every 1m; carries `?serialNumber&macAddress&model&version` — real device identity (`F43E0FEFA14C` / `DC:2C:6E:C9:D9:B0` / `RB952Ui-5ac2nD` / `6.49.12`). Pull-discovery works. |
| Session sync | **PASS** | 15s loop; `/import` inside scheduler context works (verified via observable marker — identity renamed by a fetched script). |
| Persistence | **PASS** | Full reboot: config, scripts, schedulers, hotspot, users all persisted; heartbeat+sync resumed with no intervention. |

## 4. Omada results

| Test | Result | Notes |
|---|---|---|
| Discovery | **NOT TESTED** | No Omada EAP on the LAN (subnet scan: only the MikroTik alive). |
| Identity / DHCP / Reachability / SSID / Client connectivity / Controller / Automatic provisioning | **NOT TESTED** | Device absent — nothing inferred, nothing claimed. |

```
OMADA PROVISIONING:    NOT TESTED — hardware unavailable
PHYSICAL INTEGRATION:  NOT TESTED — hardware unavailable
```

Minimum onboarding method cannot be determined without the device. When an EAP
is available: identify exact model/firmware, check for standalone vs
controller-required mode, test DHCP behavior behind the MikroTik, and determine
whether standalone mode exposes a usable management surface.

## 5. Actual measured timings (physical execution)

| Operation | Time |
|---|---|
| API connect + full discovery snapshot (cold) | 428–1284 ms |
| Discovery snapshot (warm, repeated) | 76 ms (avg latency 99 ms) |
| `testConnection` | 70 ms |
| Identity match (in-process) | <1 ms |
| `ip-binding` bypass add | 121 ms |
| Hotspot server create (`/ip hotspot add`) | 65 ms |
| Hotspot user profile create | 173 ms · update 111 ms |
| Bootstrap script fetch (6 KB over LAN) | ~1.0 s |
| Bootstrap `/import` apply | 4.4–5.4 s |
| Heartbeat interval | 60 s (scheduled) |
| Session sync interval | 15 s (scheduled) |
| Captive → portal page served | <2 s (client-perceived) |
| Session expiry → captive | <15 s (bounded by sync interval) |
| Router reboot → API back | ~46 s |
| Bad-credential refusal | 37–81 ms |
| Unreachable-host detection | ~10 s (socket timeout) |

**Estimated end-to-end:** bootstrap pull+apply ≈ 6 s, hotspot+portal ≈ seconds,
heartbeat first report within 60 s. The per-router *software* portion is well
inside the 8–15 min target; the real install time is dominated by physical
work (cabling, reset, phone scan, client test) not software.

## 6. Bugs found by hardware testing — and fixed

### Bug 1 — `matchIdentity` false-MISMATCH on MAC case
`normalizeRouterMac` lowercases, but the comparison used the **un-normalized
stored value**. RouterOS reports uppercase (`DC:2C:6E:C9:D9:B0`), so a claim
with the device's *real* MAC returned MISMATCH. Any asset row written before
normalization (or via a different path) would have failed claims forever.
**Fixed** in `services/installation/identity.service.ts` — both sides normalized.

### Bug 2 — heartbeat identity params unreachable (would 404 in production)
The heartbeat script appended `&serialNumber=…` to a URL with no `?`, producing
`/bootstrap/heartbeat/KEY&serialNumber=…`. Express binds that entire string as
`:provisioningKey` → lookup fails → 404 → **every heartbeat would die silently
and pull-discovery would never have worked**. Found by watching real requests.
**Fixed** in `services/router-provisioning.service.ts` (`&` → `?`); verified —
heartbeats now arrive as `?serialNumber=F43E…&macAddress=DC:2C…`.

Both fixes re-verified against the hardware after the change.

## 7. Real-world findings (behavior, not code bugs)

1. **`testConnection()` loses failure detail.** It returns `false` for both
   `CANTLOGIN` (auth) and `SOCKTMOUT` (unreachable) — the underlying
   `RosException.errno` is logged but swallowed. Requirement: distinguishable
   installer errors. **P1: return/throw the errno so AUTHENTICATION_FAILED and
   ROUTER_UNREACHABLE map correctly.**
2. **Enabling hotspot on the management interface locks out the manager.** All
   TCP from unauthenticated LAN clients is intercepted by the servlet. Correct
   order verified on hardware: **`ip-binding bypass` first, then hotspot**.
   (Production WAN-side management is unaffected — this hits LAN-side installs.)
3. **Stale host entries don't re-evaluate `ip-binding`.** A host already in
   `/ip hotspot host` keeps `bypassed=false` until idle-timeout (~5m) even
   after the binding is added — caused a second lockout. Mitigation: remove the
   host entry after adding the binding, or add binding before hotspot exists.
4. **`rlogin.html` vs `login.html`.** Clients arriving without redirect params
   (typing the router IP directly, OS captive checks) are served `rlogin.html`,
   not `login.html`. The phone repeatedly showed `rlogin` while `login` was
   already updated — looked exactly like a servlet cache bug. **P1: portal file
   updates must write login.html + rlogin.html + flogin.html.** The bootstrap
   already fetches all three — verified.
5. **`/import` inside scheduler context works.** Proven with an observable
   marker — the whole pull-sync mechanism is sound on RouterOS 6.49.
6. **`mode=https` in `/tool fetch` is ignored on v6.49 when the URL is
   `http://`.** All fetches worked over plain HTTP. For production, ensure the
   `apiUrl` is `https://` — the mode flag is cosmetic on v6.
7. **`limit-uptime` set mid-session does not evict a live session** — it applies
   to the user's cumulative counter at next auth. Production's sync-driven
   removal (kick `active` + remove `user`) is the correct path and was verified.
8. **Factory WiFi caveat:** radios logged `pre-shared key authentication not
   enabled, disable WPS` and wouldn't run until `wps-mode=disabled` — then
   SSIDs broadcast fine. Bootstrap should set `wps-mode=disabled` on the
   hotspot wlans (or the wlan config the installer creates).
9. **`MikroTikService.createOrUpdateProfile`'s `hotspotName` param is unused**
   — it only writes `/ip hotspot/user/profile`. Cosmetic; noted for the audit.
10. **MNDP discovery unauthenticated:** no reply observed (Windows firewall +
    broadcast constraints). The API path is the reliable discovery channel.

## 8. Failure matrix — physically exercised

| Injected failure | Observed | Status |
|---|---|---|
| Wrong MAC claim | `DEVICE_IDENTITY_MISMATCH` | ✅ correct |
| Device already assigned | `DEVICE_ALREADY_ASSIGNED` | ✅ correct |
| Cross-tenant device | `DEVICE_ALREADY_OWNED` | ✅ correct |
| Invalid credentials | refused, `CANTLOGIN` distinguishable at connect | ✅ correct refusal — ⚠️ `testConnection` returns `false` not the errno |
| Router unreachable | refused, `SOCKTMOUT` ~10s | ✅ correct — ⚠️ same collapse issue |
| Backend unreachable | router logs `TRIVA sync failed` / `heartbeat failed`, keeps retrying | ✅ fails safe, self-heals on return |

`TRIVA_API_UNAVAILABLE`/`PORTAL_UNAVAILABLE` are surfaced router-side as
warning logs; there is currently no path that reports *their* failure back —
documented as a gap (the router can't push diagnostics unless the API is up).

## 9. What is NOT covered

- DB-backed `/api/install` lifecycle — no local Postgres/Docker on this machine.
  Service layer was exercised directly; HTTP endpoints unexercised.
- Real payment flow / AnyPay callback — needs the backend + test credentials.
- The actual Triva portal HTML/UX — a lab stub + form verified servlet delivery;
  the real `login.html`/`rlogin.html`/`flogin.html` set deploys the same way.
- Omada EAP — absent (see §4).
- HTTPS-only captive detection quirks on the phone (HTTPS warnings are inherent
  to captive portals; the portal appeared via the standard intercept correctly).
- Load/scale — single client, single router.
- `dataCaps`, WAN/LAN/firewall/VLAN push, Omada controller, barcode UI —
  `NOT_IMPLEMENTED`/`false` in the registry, unchanged and unchanged-correct.

## 10. P1 recommendations

**Critical**
- Ship the two fixes (identity normalization, heartbeat `?`) — they are
  already applied and re-verified in this working tree.
- Fix `testConnection` to preserve `errno` so `AUTHENTICATION_FAILED` vs
  `ROUTER_UNREACHABLE` reach the installer instead of a bare `false`.

**High**
- Document/enforce the provisioning order for local-LAN installs:
  `ip-binding` bypass → hotspot enable → (remove stale host entry).
- Ensure portal deployment writes all three files: `login.html`, `rlogin.html`,
  `flogin.html`.
- Decide whether `CONFIGURE_HOTSPOT_SERVER` becomes an executor action —
  physically proven feasible; add it deliberately with the mgmt-bypass ordering.

**Medium**
- Bootstrap should set `wps-mode=disabled` on the wireless interfaces it
  manages (open-network radios won't run otherwise on this unit).
- `limit-uptime` is *not* the expiry mechanism — keep sync-driven removal; note
  this in the installer docs so nobody "fixes" it later.
- `--detectOpenHandles` cleanup in tests (worker leak warning observed).

**Future**
- Winbox/MAC-based management fallback for LAN-side lockout recovery.
- Report router-side fetch/heartbeat failures back to the backend when the API
  is reachable (last-error in heartbeat params).
- Omada onboarding — blocked pending hardware.

## 11. Success criteria — honest answers

| Question | Answer |
|---|---|
| Can Triva identify and safely claim a physical MikroTik? | **Yes** — after the normalization fix, exact-match claims pass and ownership boundaries hold. |
| Can Triva read the actual RouterOS state? | **Yes** — full snapshot incl. interfaces, MACs, IPs, DHCP, hotspot. |
| Can Triva provision the currently supported configuration? | **Yes** — hotspot profile write+read-back verified; bootstrap applies fully; walled-garden installed. |
| Can the resulting router provide the Triva captive portal? | **Yes** — real phone was captive, got DHCP, saw the portal page, logged in. |
| Can a real phone connect? | **Yes** — open SSID → DHCP → captive → portal → auth → internet. |
| Can a real customer payment activate access? | **Partially proven** — the activation mechanism (sync→MAC-bound user→auth→internet) and the expiry mechanism (sync→kick→captive) are verified with a simulated session; the AnyPay/callback segment is untested. |
| Can Triva detect and explain failures? | **Mostly** — error codes are correct; `testConnection` collapses causes (P1). |
| Can the Omada EAP physically operate behind the MikroTik? | **Unknown — not tested; device absent.** |

## 12. Secrets hygiene

- No router passwords, API keys, DB credentials, or encryption keys in this
  document or the committed harness. Factory `admin`/blank is a default, not a
  secret. `testuser`/`test123` and `trk_phase5b_testkey123` are throwaway lab
  values on dedicated reset-able test hardware.
- The bootstrap script legitimately embeds the router-API password for the
  `triva-agent` account (the router needs it at pull-time); this is by design —
  the known bearer-URL risk documented in Phase 5A stands: the bootstrap URL is
  a one-credential bearer and should move to a one-time token (already P1).

---
*Physical validation performed against a dedicated factory-reset test unit on an
isolated lab segment. Legacy production was not touched.*
