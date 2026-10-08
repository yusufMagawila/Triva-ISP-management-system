# Example: Complete New-Site Installation

**Scenario:** installer arrives at *Neema's Minimarket* in Mbezi, Dar es Salaam — a shop wanting paid customer WiFi. Hardware: one factory-default MikroTik hAP ac2 and one Omada EAP225. ISP: cable already in WAN port (DHCP). Customer has an AnyPay merchant account and a Tanzanian phone.

**Legend:** `INSTALLER` = human · `COPILOT` = conversation (Gemini-assisted) · `[SYSTEM]` = deterministic backend · `[DISCOVERY]` = device evidence · `[GEMINI]` = LLM proposal · ⚠ = future capability (not yet implemented — shown as the *desired* flow)

> Steps marked ⚠ require development work listed in `README.md`. Steps without it work in the current codebase. This example shows the target flow; where today's system can't do a step, it's flagged and the manual substitute is named.

---

## Stage 1–2: Customer & Site

**COPILOT:** Karibu! New site installation. Is this a new customer or an existing business?

**INSTALLER:** New customer — Neema's Minimarket.

**COPILOT:** Owner's name and phone?

**INSTALLER:** Neema Mushi, 0712 345 678.

**COPILOT:** And an email for their dashboard login?

**INSTALLER:** neema.minimarket@gmail.com

**[SYSTEM]** `tenant.create` → `Tenant{id, name:"Neema's Minimarket", phone:"+255712345678", email:…}` + merchant `User` + `Subscription(PENDING_ACTIVATION)`. ⚠ *Tenant creation currently happens via admin/signup before the installer arrives; the Copilot path needs an install-scoped creation endpoint.*

**COPILOT:** Site name — I'll default to "Neema's Minimarket — Main", location "Mbezi, DSM". About how many customers at once?

**INSTALLER:** Fine. Maybe 25.

**[GEMINI]** proposal → `site.profile: TRIVA_STANDARD`, `expectedUsers: 25`, `site.name` (confidence 0.95).
**[SYSTEM]** validated — `siteId` created. ⚠ *`Site` model doesn't exist yet.*

---

## Stage 3: MikroTik hardware — scan, bootstrap, match

**COPILOT:** Let's set up the MikroTik. Point your camera at the label on the bottom.

**INSTALLER:** *(scans)* `DC:2C:6E:AA:BB:01`, serial `HEX12345`. ⚠ *Camera/barcode scanning doesn't exist — today the installer would type MAC+serial into the router form.*

**[SYSTEM]** `mikrotik.assetCreate` → `Router{name, tenantId, serialNumber:HEX12345, hardwareMac:DC:2C:…, controlPlaneIp:10.251.0.12, provisioningKey:pk_…}`. Identity state: `UNMATCHED` (claim only).

**COPILOT:** Now plug power + the internet cable into port 1, and your laptop/phone into the Triva setup. I'll push the bootstrap. ⚠ *Today: installer must create the hotspot server + `/import` the auto-installer script manually. Future: a setup SSID/netinstall path or a one-click "send bootstrap" from the Copilot UI.*

**[DISCOVERY]** Router fetches `GET /bootstrap/router/pk_…?serialNumber=HEX12345&macAddress=DC:2C:6E:AA:BB:01` → backend binds identity, `match=MATCHED`, `status=ONLINE`, `lastBootstrapIp=197.186.x.x`.

**COPILOT:** ✓ MikroTik found — MAC matches the label you scanned. hAP ac2, outbound connection is live. WAN gave it a DHCP address. ⚠ *model/RouterOS version aren't captured today — new discovery fields needed.*

**[GEMINI]** say: "Router is online and the WAN works. Configuring hotspot next." desiredAction → `mikrotik.hotspotEnsure{hotspot1}` + `mikrotik.emitInstallerScript`.

**[SYSTEM]** Policy check: actions allowed → execution plan. Installer script already ran via bootstrap (pull model — no inbound needed). Portal pages + walled garden applied by the script itself.

**Approval gate:** COPILOT: "Apply the Triva hotspot config to this router?" — **INSTALLER: Confirm.** *(Human gate — Gemini cannot approve.)*

---

## Stage 4–5: WAN & LAN (mostly discovery)

**[DISCOVERY]** ⚠ `wan.type=DHCP, hasIp=true, outboundHttps=PASS` (a diagnostic step in the sync script reports WAN state).

**COPILOT:** Internet is working automatically — no questions needed. For the customer network I'll use 192.168.88.0/24 with DHCP 100–254. Any existing equipment here — CCTV, POS — that I should avoid?

**INSTALLER:** There's a CCTV box on 192.168.88.50.

**[GEMINI]** proposal → `network.lan.dhcpPool: 192.168.88.100–254` (already avoids .50), `installerNotes += CCTV at .50`. confidence 0.9.
**[SYSTEM]** validator: pool ⊂ subnet, no overlap with `10.251.0.0/16` → CONFIRMED.

---

## Stage 6–7: Omada EAP + WiFi

**COPILOT:** Now the access point. Is there an Omada controller on this network, or do we run the EAP standalone?

**INSTALLER:** There's an OC200 at 192.168.88.10.

**COPILOT:** I'll need the controller's admin login to configure it — typing it here stores it in Triva's encrypted vault; I never see it again. ⚠ *Today the operator configures the controller manually; an Omada API client is future work. The credential goes straight to `secretRef` — Gemini context only sees `{present:true}`.*

**INSTALLER:** *(enters creds)*

**[SYSTEM]** `omada.siteCreate` → `OmadaSite{name, controllerUrl:"https://192.168.88.10", controllerIp:192.168.88.10}` + generated `radiusSecret` (server-side) + FreeRADIUS `nas` row.

**[DISCOVERY]** ⚠ controller API reports EAP225 `B8:4D:…:02` adopted, firmware current.
**[SYSTEM]** label-claim vs controller-reported MAC → `match=MATCHED`.

**COPILOT:** What should the WiFi be called? I'd suggest "Neema's Minimarket WiFi".

**INSTALLER:** Good.

**[GEMINI]** proposal → `wifi.ssid` (confidence 0.95), `security: OPEN_PORTAL` (deterministic — captive model).
**[SYSTEM]** `omada.controllerConfigure` ⚠ — SSID + external-portal URL + RADIUS profile pushed via controller API. *(Today: installer does this in the controller UI; backend emits the portal page package via `downloadPortalPage`.)*

**COPILOT:** Portal welcome message? Default: "Karibu Neema's Minimarket! Choose a package to connect."

**INSTALLER:** Default is fine. Keep the blue.

**[SYSTEM]** `portal.brandingSet` → `portalNoticeName/Message/Color`.

---

## Stage 8: Billing

**[DISCOVERY]** `payment-settings/test` → AnyPay credential bundle present + live test PASS (masked `••••7890`).

**[GEMINI]** proposal → plan set, justified by "retail shop, ~25 users, Tanzanian market":

| Plan | Price | Duration | Speed |
|---|---|---|---|
| 1 Hour | 500 TZS | 60 min | 5/2 Mbps |
| Half Day | 800 TZS | 6 h | 5/2 Mbps |
| 1 Day | 1,000 TZS | 24 h | 10/5 Mbps |
| 1 Week | 5,000 TZS | 7 d | 10/5 Mbps |

**COPILOT:** Here are suggested packages — edit anything before I create them.

**INSTALLER:** Drop "Half Day". Rest is good.

**[SYSTEM]** `plan.bulkCreate` ×3 → `Plan` rows. Vouchers enabled (default yes).

---

## Stage 9–10: Security & Verification

**[SYSTEM]** Dedicated router API user provisioned (least privilege, `secretRef`), local admin password set from installer input, `TRIVA_BASELINE` firewall profile. All deterministic — none of this was a question.

**[SYSTEM]** `diagnostics.run`: WAN IP ✓ · outbound HTTPS ✓ · portal fetch 200 ✓ · sync loop heartbeating ✓ · RADIUS NAS auth test ✓ · hotspot server `hotspot1` active ✓

**COPILOT:** Last step — join "Neema's Minimarket WiFi" on your phone. You should see the portal.

**INSTALLER:** Connected — I see the portal with the shop name.

**COPILOT:** I'm sending a 100 TZS test charge to +255712345678 — approve the push.

**INSTALLER:** Approved — got internet!

**[SYSTEM]** Payment PENDING → AnyPay push → webhook → status-API verify → COMPLETED (authoritative amount) → `Session` ACTIVE (direct API; pull-sync fallback armed). Omada path: `OmadaPortalToken` minted, single-use, 60s TTL.

**[GEMINI]** say: "Payment verified at 100 TZS, session is active, internet confirmed. Installation complete." — explanation only.

---

## Stage 11: Completion

**[SYSTEM]** `install.finalize` → `Installation{state:APPROVED→EXECUTED, diagnostics:ALL PASS}`, site ACTIVE, audit trail persisted. ⚠ *`Installation` record + audit table don't exist yet.*

**COPILOT:** ✓ **SITE ONLINE** — Neema's Minimarket — Main. Dashboard: app.trivaconnect.site (login emailed). Packages: 3 live, vouchers on. Anything to note for support?

**INSTALLER:** CCTV on .50, leave it alone. Done.

---

## Failure/recovery walkthroughs (same install, things go wrong)

| Problem | Detection | Copilot behavior | Allowed action | Recovery |
|---|---|---|---|---|
| Router never calls bootstrap (5 min) | `mikrotik.awaitBootstrap` timeout | Gemini explains likely causes (no WAN, script not imported, no hotspot server) + asks "is the internet cable in port 1?" | Re-emit script, extend wait | Manual Winbox fallback path already exists in `getRouterSetupScript` |
| Scanned MAC ≠ reported MAC | `match=MISMATCH` | "This router's label doesn't match what checked in — are there two MikroTiks here?" | Rescan / pick different asset | Blocked until MATCHED — never proceeds |
| Serial bound to another tenant | unique-constraint / ALREADY_OWNED | "This router is registered to another business — contact support." | Escalate only | No silent reassignment possible |
| WAN static but not entered | Discovery: `wan.hasIp=false` | Ask 4.3 | `mikrotik.wanConfigure` static | Re-run diagnostics |
| AnyPay test fails | `payment-settings/test` FAIL | "AnyPay credentials rejected — re-enter, or launch voucher-only?" | Re-enter / voucher-only flag | Stage degrades gracefully |
| Payment push never arrives | Reconciler keeps PENDING | "No confirmation yet — check the phone has signal; I can resend." | Re-initiate | 15s reconciler resolves late completions automatically |
| Portal page won't load on phone | Diagnostic `PORTAL_FETCH` FAIL | Check walled-garden entries + hotspot server | Re-run script section | Manual checklist emitted |
| Gemini unavailable | Orchestrator circuit-breaker | Wizard continues deterministically | — | Same contract, plain forms — install never blocks on AI |
