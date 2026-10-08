/**
 * Capability registry — the honest answer to "what can Triva actually do?"
 *
 * Generated from what is actually implemented in this codebase, not from
 * what the UI or docs claim. The future Copilot/Gemini layer queries this to
 * avoid recommending unsupported operations. If a capability is false, the
 * policy validator will reject actions that need it.
 */

export interface VendorCapabilities {
  // Identity & onboarding
  assetRegistration: boolean;
  bootstrapPullSync: boolean;      // router-initiated script fetch
  identityBinding: boolean;        // serial/MAC binding on first check-in
  // Read-back
  liveDiscovery: boolean;          // direct API read (requires reachable API)
  heartbeatIdentityReport: boolean; // model/version via heartbeat params
  // Configuration push
  wanConfiguration: boolean;
  lanConfiguration: boolean;
  dhcpConfiguration: boolean;
  firewallConfiguration: boolean;
  hotspotConfiguration: boolean;   // hotspot server creation (not just user add)
  captivePortalPages: boolean;
  hotspotUserProvisioning: boolean;
  // Hardware handling
  barcodeScanning: boolean;        // physical scan → identity
  apDiscovery: boolean;            // discovering connected APs
  controllerApiProvisioning: boolean;
  // Ops
  sessionExpiry: boolean;
  manualDisconnect: boolean;
  dataLimitEnforcement: boolean;
  usageAccounting: boolean;
  rollback: boolean;
}

export interface CapabilityRegistry {
  schemaVersion: string;
  mikrotik: VendorCapabilities;
  tplink: VendorCapabilities;
  omada: {
    siteAssetRegistration: boolean;
    radiusNasRegistration: boolean;
    perSessionRadiusCredentials: boolean;
    portalTokenExchange: boolean;
    portalPagePackage: boolean;
    controllerDiscovery: boolean;      // Omada SDN API client — not implemented
    controllerApiProvisioning: boolean;
    apInventory: boolean;
    healthCheck: boolean;              // only inferred from RADIUS auth traffic
  };
  billing: {
    anypay: boolean;
    vouchers: boolean;
    dataCaps: boolean;                 // dataLimitMb exists but is NOT enforced
    refunds: boolean;
    subscriptionPayments: boolean;
  };
  installation: {
    wizardApi: boolean;
    policyValidator: boolean;
    structuredActions: boolean;
    auditLog: boolean;
    installerRole: boolean;
    scopedInstallerTokens: boolean;
    siteModel: boolean;
    customerModel: boolean;
    llmAssist: boolean;                // Gemini — explicitly not integrated
  };
  profiles: string[];                  // allowed configuration profiles
  actions: string[];                   // closed executor vocabulary (implemented only)
  declaredNotImplemented: string[];    // known action names returning NOT_IMPLEMENTED
}

export function getCapabilityRegistry(implementedActions: string[], declaredNotImplemented: string[]): CapabilityRegistry {
  return {
    schemaVersion: '1.0',
    mikrotik: {
      assetRegistration: true,
      bootstrapPullSync: true,
      identityBinding: true,
      liveDiscovery: true,               // requires router API reachability
      heartbeatIdentityReport: true,     // model/version/serial/MAC via heartbeat
      wanConfiguration: false,           // not implemented — emits NOT_IMPLEMENTED
      lanConfiguration: false,
      dhcpConfiguration: false,
      firewallConfiguration: false,
      hotspotConfiguration: false,       // not an executor action; /ip hotspot add IS feasible on hw (Phase 5B) but requires mgmt bypass ordering
      captivePortalPages: true,
      hotspotUserProvisioning: true,
      barcodeScanning: false,
      apDiscovery: false,
      controllerApiProvisioning: false,
      sessionExpiry: true,
      manualDisconnect: true,
      dataLimitEnforcement: false,
      usageAccounting: false,
      rollback: false,
    },
    tplink: {
      assetRegistration: true,
      bootstrapPullSync: true,
      identityBinding: true,
      liveDiscovery: false,
      heartbeatIdentityReport: true,
      wanConfiguration: false,
      lanConfiguration: false,
      dhcpConfiguration: false,
      firewallConfiguration: false,
      hotspotConfiguration: false,       // requires pre-installed OpenWrt+nodogsplash
      captivePortalPages: true,
      hotspotUserProvisioning: true,
      barcodeScanning: false,
      apDiscovery: false,
      controllerApiProvisioning: false,
      sessionExpiry: true,
      manualDisconnect: true,
      dataLimitEnforcement: false,
      usageAccounting: false,
      rollback: false,
    },
    omada: {
      siteAssetRegistration: true,
      radiusNasRegistration: true,
      perSessionRadiusCredentials: true,
      portalTokenExchange: true,
      portalPagePackage: true,
      controllerDiscovery: false,
      controllerApiProvisioning: false,
      apInventory: false,
      healthCheck: false,                // lastSeenAt is inferred, not probed
    },
    billing: {
      anypay: true,
      vouchers: true,
      dataCaps: false,                   // column exists; no enforcement code
      refunds: false,
      subscriptionPayments: true,
    },
    installation: {
      wizardApi: true,
      policyValidator: true,
      structuredActions: true,
      auditLog: true,
      installerRole: true,
      scopedInstallerTokens: true,
      siteModel: true,
      customerModel: true,
      llmAssist: false,
    },
    profiles: ['TRIVA_BASIC', 'TRIVA_STANDARD', 'TRIVA_BUSINESS', 'CUSTOM'],
    actions: implementedActions,
    declaredNotImplemented,
  };
}
