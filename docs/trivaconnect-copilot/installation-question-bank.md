# TrivaConnect Copilot — Installation Question Bank

The complete interview. **Guiding rule:** the Copilot asks only what cannot be discovered or derived — see `auto-discovery.md`. Every question lists: purpose, required/optional, whether auto-detection applies, answer type, validation, default, who controls it, Gemini's role, and the backend action it feeds.

Question IDs are stable keys into the configuration contract (`state.requested`).

**Classification legend:** `REQ` required · `OPT` optional · `AUTO` auto-detected (ask only to confirm) · `DRV` derived · `ADMIN` admin-defined (never asked) · `GEM` Gemini may recommend (backend validates) · `DET` deterministic (never Gemini)

---

## STAGE 1 — CUSTOMER

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 1.1 | "Is this a new customer, or an existing business adding a site?" | Routing: create tenant vs attach site | REQ | Installer | — | enum: NEW/EXISTING | branch |
| 1.2 | "Business/customer name?" | `Tenant.name` | REQ | Installer | Transcribe | 2–80 chars | `tenant.create` |
| 1.3 | "Owner/contact person's name?" | Support + portal contact | REQ | Installer | Transcribe | 2–60 | stored on tenant/site |
| 1.4 | "Phone number?" | `Tenant.phone`; used for account + support | REQ | Installer | Normalize to +255… | E.164, TZ mobile prefixes (`255[67]…`) | `tenant.create` |
| 1.5 | "Email for the dashboard login?" | `User.email` / `Tenant.email` | REQ | Installer | — | RFC email, unique | `tenant.create` |
| 1.6 | "Physical address / area?" | `Tenant.address` + site location | OPT | Installer | — | free text ≤200 | `tenant.create` |

*Only asked when 1.1 = NEW. For EXISTING: installer picks the tenant from their authorized list (or types registered phone → backend lookup, `AUTO` on confirmation).*

## STAGE 2 — SITE

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 2.1 | "What should we call this site?" (default: "{business} — Main") | `Site.name` (new model) / device `location` | REQ w/ default | Installer | Suggest from business name | 2–60 | `site.create` |
| 2.2 | "Where is it — area, street, or GPS?" | `site.location` | REQ | Installer (+GPS capture `[NEW]`) | — | text or lat/lon | `site.create` |
| 2.3 | "What is this WiFi for?" — customer-paid hotspot / staff+guest / both | Selects config profile + portal mode | REQ | Installer | Interpret intent → profile | enum | profile select |
| 2.4 | "About how many people will use it at once?" | Plan bandwidth recommendation | REQ | Installer | — | int 1–2000 | plan sizing (GEM) |
| 2.5 | "Indoor coverage, outdoor, or both? Roughly how big is the area?" | AP count/placement recommendation | REQ | Installer | Recommend AP count + placement | enum + text | advisory only |
| 2.6 | "How many access points are we installing today?" | Expected AP count → verification target | REQ | Installer | — | int ≥0 | AP count check at verify |
| 2.7 | "Is this router new/factory-default, or already configured?" | Chooses bootstrap vs adopt-existing path | REQ | Installer | — | enum | flow branch |

## STAGE 3 — HARDWARE

*Asked only if 2.7 says so. If "factory default", most of this stage is discovery, not questions.*

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 3.1 | "Scan or type the MAC/serial on the MikroTik label." | Identity claim → deterministic match | REQ if asset registration precedes bootstrap | Installer `[INSTALLER]` | Read photo → MAC/serial `[NEW]` | MAC/serial regex | `mikrotik.assetCreate` + match |
| 3.2 | *(auto)* "Found hAP ac2, MAC …, RouterOS 7.x — is this the router in your hand?" | Confirm scanned claim vs reported evidence | AUTO-CONFIRM | Discovery | Phrase confirmation | `match == MATCHED` required | identity bind |
| 3.3 | "How many Omada EAPs, and which model?" (only if Omada chosen) | Expected inventory | REQ if Omada | Installer | — | int + model enum | verify checklist |
| 3.4 | "Is there an Omada controller on the LAN? Software controller, OC200/OC300, or none yet?" | Determines whether RADIUS path is even possible today | REQ if Omada | Installer | Explain options | enum | flow branch |
| 3.5 | "Are any of these devices already assigned in Triva?" (shown, not asked — system checks) | Ownership conflict | AUTO | System | Explain conflict | serial/MAC unique scan | block + escalate |
| 3.6 | "Is this replacing a broken device at an existing site?" | Reassignment flow | OPT | Installer | — | enum | `device.reassign` `[NEW]` |

## STAGE 4 — WAN

*Discovered automatically once the router bootstraps (DHCP state, WAN IP). Questions exist only for the pre-connect or static cases.*

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 4.1 | "Is the internet cable already plugged into the MikroTik WAN port?" | Decides wait-vs-configure | REQ | Installer | — | yes/no | gate discovery wait |
| 4.2 | "Did the ISP give you a static IP, PPPoE login, or is it automatic?" | WAN config type | REQ unless discovered first | Installer | — | enum DHCP/STATIC/PPPOE | `mikrotik.wanConfigure` |
| 4.3 | *(if STATIC)* "Static IP, gateway, and DNS?" | Cannot be guessed | COND-REQ | Installer | — | IPv4 + CIDR sanity | `mikrotik.wanConfigure` |
| 4.4 | *(if PPPOE)* "PPPoE username and password?" | Credential — stored as `secretRef`, **never to Gemini** | COND-REQ | Installer | Never sees value | non-empty | `mikrotik.wanConfigure` w/ secretRef |
| 4.5 | *(auto)* "WAN got IP …, outbound HTTPS to trivaconnect.site works." | Proof of reachability | AUTO | Discovery | Explain failure + next step | evidence = bootstrap call | `diagnostics.run` |
| 4.6 | "About what speed is the line?" | Sanity-check plan limits (advisory) | OPT | Installer | Recommend caps | Mbps int | advisory only |

## STAGE 5 — LAN

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 5.1 | "Any existing network/devices here we must not break — CCTV, POS, printer?" | Conflict awareness before subnet choice | REQ | Installer | Reason about topology | yes/no + text | subnet choice input |
| 5.2 | *(auto/GEM)* "I'll use 192.168.88.0/24 for customers with DHCP 100–254. OK?" | LAN plan | REQ w/ default | GEM-recommended | Recommend non-conflicting subnet | RFC1918, no overlap w/ 10.251/16 + discovered | `mikrotik.lanConfigure` |
| 5.3 | "Do you need VLANs or a separate staff network?" | Profile complexity | OPT | Installer | — | yes/no (+VLAN IDs if yes) | profile → CUSTOM path |

## STAGE 6 — WIFI

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 6.1 | "What should the WiFi be called?" (default: "{business} WiFi") | SSID | REQ w/ default | Installer/GEM | Suggest from business name | ≤32 chars, no credentials-like text | `mikrotik`/`omada` wifi action |
| 6.2 | "Hide the network name?" | SSID visibility | OPT (default no) | Installer | — | bool | wifi action |
| 6.3 | *(ADMIN, not asked)* Security = open + captive portal; client isolation on | Captive portal model mandates | DET | System | — | fixed | portal mode |
| 6.4 | *(if Omada)* "Same SSID on all EAPs?" | AP group config | OPT (default yes) | Installer | — | bool | `omada.controllerConfigure` |

## STAGE 7 — CAPTIVE PORTAL

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 7.1 | "What welcome message should customers see?" | `Tenant.portalNoticeMessage` | OPT w/ default | Installer | Draft Swahili/English text | ≤300 chars | `portal.brandingSet` |
| 7.2 | "Business name to show on the portal?" | `portalNoticeName` | OPT w/ default | Installer | — | ≤60 | `portal.brandingSet` |
| 7.3 | "Portal color?" (pick from preset swatches) | `portalNoticeColor` | OPT | Installer | Suggest from logo `[NEW]` | hex | `portal.brandingSet` |
| 7.4 | "Any terms/notice customers must see?" | Compliance text | OPT | Installer/Customer | Draft | ≤500 | `portal.brandingSet` |

## STAGE 8 — BILLING

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 8.1 | "Does the business have an AnyPay merchant account set up?" | Payment readiness gate | REQ | Installer | Explain how to get one | yes/no/not-yet | blocks activation if no |
| 8.2 | *(if not yet)* "Use vouchers only until AnyPay is ready?" | Degraded launch path | COND-REQ | Installer | — | bool | provider=VOUCHER flag |
| 8.3 | *(auto)* "AnyPay is configured and the test call passed." | Credential health | AUTO | System `payment-settings/test` | Explain failure | 200 + masked confirm | readiness check |
| 8.4 | "Which packages do you want to sell?" — Copilot proposes 3–4 plans w/ prices+durations+speeds | `Plan` rows | REQ w/ GEM proposal | GEM → installer edits | Recommend TZ-typical set (e.g. 500/1h, 1000/day, 5000/week) | price>0, mins>0, kbps>0|null | `plan.bulkCreate` |
| 8.5 | "Sell voucher codes as well as mobile-money?" | `vouchersEnabled` | OPT (default yes) | Installer | — | bool | voucher feature flag |
| 8.6 | "Support phone number to print on the portal/vouchers?" | `supportContact` | OPT | Installer | — | phone | operations block |

*Not asked (derived/admin):* payment provider (ANYPAY-only architecture), webhook URLs (derived), session credential generation (system), platform subscription tier (SUPER_ADMIN's job, separate flow).

## STAGE 9 — SECURITY

Mostly admin-defined; a few confirms:

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 9.1 | *(auto)* "I created a dedicated router API account for Triva (not admin)." | Principle of least privilege — done by script | AUTO | System | Explain | `apiUserRef` exists | assetCreate creds |
| 9.2 | "Who should get the dashboard login — owner email confirmed?" | User provisioning | REQ | Installer | — | email | `tenant.create` user |
| 9.3 | *(ADMIN)* remote management allowed networks, credential rotation, HTTPS-only — all `TRIVA_BASELINE` policy | Security floor | DET | System | Explain only | fixed | firewall profile |
| 9.4 | "Set a local admin password on the MikroTik now?" (factory units often have none) | Hardening | REQ if factory | Installer → `secretRef` | **Never sees value** | length ≥12 | `mikrotik` hardening action `[NEW]` |

## STAGE 10 — VERIFICATION

| # | Question/step | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 10.1 | *(auto)* Diagnostics: WAN IP, outbound HTTPS, portal fetch, hotspot/RADIUS live, sync loop running | Health gate | AUTO | System | Interpret results, suggest next step | all PASS | `diagnostics.run` |
| 10.2 | "Join the WiFi on your phone — do you see the portal?" | Real-world proof | REQ | Installer | Guide through captive flow | portal page served | test session |
| 10.3 | "I'll run a 100-TZS test payment (or a test voucher) — watch for the push." | Payment E2E | REQ | Installer + customer phone | Walk through | COMPLETED payment | test payment |
| 10.4 | "Confirm the internet works on the test session." | Activation proof | REQ | Installer | — | session ACTIVE + traffic | `install.finalize` gate |

## STAGE 11 — COMPLETION

| # | Question | Why | Req? | Source | Gemini role | Validation | Backend action |
|---|---|---|---|---|---|---|---|
| 11.1 | "Anything unusual to note for support?" | `installerNotes` | OPT | Installer | Transcribe | ≤1000 | install record |
| 11.2 | "Hand over to the customer — show them the dashboard URL and their login?" | Handoff | REQ | Installer | Script the handoff | confirmed | finalize |
| 11.3 | *(auto)* Installation record persisted; site ACTIVE; summary card shown | Closure | AUTO | System | Write summary | — | `install.finalize` |

---

## Conditional logic summary

- Omada questions (3.3–3.4, 6.4) only if the site includes EAPs.
- WAN detail questions (4.3–4.4) only for the chosen WAN type, and only if discovery didn't already answer.
- Stage 5/6 questions collapse to one "accept defaults?" confirm when profile `TRIVA_STANDARD` is chosen.
- Billing degrades to vouchers-only if AnyPay isn't ready (8.2).
- Every `AUTO` item is *displayed for confirmation*, not asked as an open question.

## Cross-reference

Field-level source/validation details → `auto-discovery.md`. Where each answer lands in the payload → `configuration-contract.md`. What Gemini may propose vs. what it may not → `gemini-context-contract.md`.
