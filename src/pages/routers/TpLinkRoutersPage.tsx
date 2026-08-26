import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Router, Plus, Wifi, WifiOff, RefreshCw, Trash2, Activity, Copy, Info } from 'lucide-react';
import { format } from 'date-fns';

const PORTAL_BASE = 'https://triva.pandabus.live/captive-portal';
const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

interface TpLinkRouterData {
  id: string;
  name: string;
  ipAddress: string;
  sshPort: number;
  provisioningKey: string | null;
  serialNumber: string | null;
  hardwareMac: string | null;
  openwrtVersion: string | null;
  location: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastSeenAt: string | null;
  lastBootstrapAt: string | null;
  provisionedAt: string | null;
  _count: { sessions: number };
}

export default function TpLinkRoutersPage() {
  const [routers, setRouters] = useState<TpLinkRouterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pinging, setPinging] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    serialNumber: '',
    hardwareMac: '',
    openwrtVersion: '',
    location: '',
  });

  const [showSetup, setShowSetup] = useState<string | null>(null);

  useEffect(() => { loadRouters(); }, []);

  function copyText(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  function getBootstrapScriptUrl(router: TpLinkRouterData) {
    if (!router.provisioningKey) return '';
    return `${API_BASE}/bootstrap/tplink/router/${encodeURIComponent(router.provisioningKey)}`;
  }

  function getBootstrapInfoUrl(router: TpLinkRouterData) {
    if (!router.provisioningKey) return '';
    return `${API_BASE}/bootstrap/tplink/router/${encodeURIComponent(router.provisioningKey)}/info`;
  }

  function getBootstrapInstallCommands(router: TpLinkRouterData) {
    const bootstrapUrl = getBootstrapScriptUrl(router);
    if (!bootstrapUrl) return 'Provisioning key missing. Recreate this router asset.';

    return [
      `curl -sk "${bootstrapUrl}" -o /tmp/triva-bootstrap.sh`,
      'sh /tmp/triva-bootstrap.sh',
    ].join('\n');
  }

  function getPreflightCommands(router: TpLinkRouterData) {
    const infoUrl = getBootstrapInfoUrl(router);
    return [
      '# Run these on the router over SSH (ssh root@192.168.1.1)',
      'cat /etc/openwrt_release',
      'ping -c 4 1.1.1.1',
      'nslookup triva.pandabus.live',
      'opkg update && echo "opkg OK"',
      infoUrl
        ? `curl -sk "${infoUrl}" | head -5`
        : 'echo "Bootstrap info URL unavailable. Provisioning key missing."',
    ].join('\n');
  }

  function getVerificationCommands() {
    return [
      'crontab -l | grep triva',
      'ls -la /usr/bin/triva-*.sh',
      'ndsctl status | head -20',
      'logread | grep triva | tail -20',
    ].join('\n');
  }

  function getRecoveryCommands(router: TpLinkRouterData) {
    const bootstrapUrl = getBootstrapScriptUrl(router);
    if (!bootstrapUrl) return 'Provisioning key missing. Recreate this router asset.';

    return [
      '/usr/bin/triva-heartbeat.sh',
      '/usr/bin/triva-sync.sh',
      `curl -sk "${bootstrapUrl}" -o /tmp/triva-bootstrap.sh && sh /tmp/triva-bootstrap.sh`,
    ].join('\n');
  }

  async function loadRouters() {
    try {
      const res = await api.get<{ data: TpLinkRouterData[] }>('/tplink-routers');
      setRouters(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/tplink-routers', form);
      toast.success('TP-Link router asset created');
      setShowForm(false);
      setForm({ name: '', serialNumber: '', hardwareMac: '', openwrtVersion: '', location: '' });
      loadRouters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add router');
    }
  }

  async function handlePing(id: string) {
    setPinging(id);
    try {
      const res = await api.post<{ data: { status: string; lastBootstrapAt: string | null } }>(`/tplink-routers/${id}/ping`);
      setRouters((prev) =>
        prev.map((r) => (
          r.id === id
            ? {
                ...r,
                status: res.data.data.status as TpLinkRouterData['status'],
                lastBootstrapAt: res.data.data.lastBootstrapAt ?? r.lastBootstrapAt,
              }
            : r
        ))
      );
      toast.success(
        res.data.data.status === 'ONLINE'
          ? 'Router has checked in recently'
          : 'Router is waiting for a bootstrap heartbeat'
      );
    } catch {
      toast.error('Router check failed');
    } finally {
      setPinging(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this router?')) return;
    try {
      await api.delete(`/tplink-routers/${id}`);
      setRouters((prev) => prev.filter((r) => r.id !== id));
      toast.success('Router deleted');
    } catch {
      toast.error('Failed to delete router');
    }
  }

  const selectedRouter = showSetup ? routers.find((router) => router.id === showSetup) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm" style={{ color: '#6e6e73' }}>TP-Link routers must run OpenWrt with nodogsplash. TRIVA provisions them with a one-line install command.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add TP-Link Router
        </button>
      </div>

      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
        <p className="font-semibold mb-1">OpenWrt is required</p>
        <p>Stock TP-Link firmware has no API or captive-portal hooks. Confirmed Archer AX1800 support: <strong>EU v1.0 / v1.20</strong> (uses Archer AX23 v1 OpenWrt images). US v1.20 (Broadcom) and US v4.6 / v5.6 are <strong>NOT supported</strong> by OpenWrt. Verify the hardware revision on the label before flashing — flashing an unsupported revision can brick the router.</p>
      </div>

      {/* Add Router Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold mb-5" style={{ color: '#1d1d1f' }}>Create TP-Link Router Asset</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Router Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Shop TP-Link" />
            </div>
            <div>
              <label className="label">OpenWrt Version (optional)</label>
              <input className="input" value={form.openwrtVersion} onChange={(e) => setForm({ ...form, openwrtVersion: e.target.value })} placeholder="23.05.5" />
              <p className="text-xs text-gray-500 mt-1">Record the OpenWrt release installed on the device for support purposes.</p>
            </div>
            <div>
              <label className="label">Serial Number (optional)</label>
              <input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="22405B7000123" />
              <p className="text-xs text-gray-500 mt-1">If you already know the factory serial, bind it now. Otherwise the router can bind itself on first bootstrap contact.</p>
            </div>
            <div>
              <label className="label">WAN MAC (optional)</label>
              <input className="input" value={form.hardwareMac} onChange={(e) => setForm({ ...form, hardwareMac: e.target.value })} placeholder="64:D1:54:AA:BB:CC" />
              <p className="text-xs text-gray-500 mt-1">This gives TRIVA a second bootstrap identity without assuming router reachability from the dashboard.</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Location (optional)</label>
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Shop floor, 2nd floor..." />
            </div>
            <div className="md:col-span-2 rounded-xl px-4 py-3 text-sm" style={{ background: '#f0f6ff', border: '1px solid #dceeff', color: '#1d4b8a' }}>
              TRIVA assigns the control-plane IP and bootstrap identity automatically. The router must reach <span className="font-semibold">{API_BASE}/bootstrap/tplink/router</span> on its own; no public SSH or forwarded port is assumed.
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="btn-primary">Create Asset</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Routers grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner" />
        </div>
      ) : routers.length === 0 ? (
        <div className="card p-16 text-center">
          <Router className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#6e6e73' }} />
          <p className="font-medium text-sm" style={{ color: '#3a3a3c' }}>No TP-Link router assets yet</p>
          <p className="text-sm mt-1" style={{ color: '#aeaeb2' }}>Create the first TP-Link router asset, then let the OpenWrt device self-provision from TRIVA</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {routers.map((r) => (
              <div key={r.id} className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>{r.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: '#6e6e73' }}>Control plane {r.ipAddress}:{r.sshPort}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.status === 'ONLINE' ? (
                      <Wifi className="w-4 h-4 text-green-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-red-400" />
                    )}
                    <span className={r.status === 'ONLINE' ? 'badge-green' : 'badge-red'}>
                      {r.status}
                    </span>
                  </div>
                </div>

                {r.location && (
                  <p className="text-xs mb-3" style={{ color: '#6e6e73' }}>📍 {r.location}</p>
                )}

                <div className="mb-3 rounded-xl px-3 py-2.5 text-xs" style={{ background: '#f5f5f7' }}>
                  <p className="font-semibold mb-1" style={{ color: '#1d1d1f' }}>{r.provisionedAt ? 'Provisioned asset' : 'Awaiting first bootstrap'}</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>Vendor: TP-Link (OpenWrt)</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>OpenWrt: {r.openwrtVersion ?? 'Not recorded'}</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>Serial: {r.serialNumber ?? 'Will bind on first contact'}</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>MAC: {r.hardwareMac ?? 'Will bind on first contact'}</p>
                </div>

                <div className="flex items-center gap-2 text-xs mb-4" style={{ color: '#6e6e73' }}>
                  <Activity className="w-3.5 h-3.5" />
                  <span>{r._count.sessions} active sessions</span>
                  {(r.lastBootstrapAt || r.lastSeenAt) && (
                    <span>· Last check-in {format(new Date(r.lastBootstrapAt ?? r.lastSeenAt ?? ''), 'MMM d HH:mm')}</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    className="btn-secondary btn-sm flex-1"
                    onClick={() => handlePing(r.id)}
                    disabled={pinging === r.id}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${pinging === r.id ? 'animate-spin' : ''}`} />
                    Check In
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    title="Provisioning details"
                    onClick={() => setShowSetup(showSetup === r.id ? null : r.id)}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => handleDelete(r.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedRouter && (
            <div className="card p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: '#6e6e73' }}>Zero-Touch Provisioning (OpenWrt)</p>
                  <h2 className="text-xl font-semibold mt-1" style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}>{selectedRouter.name} setup</h2>
                  <p className="text-sm mt-1" style={{ color: '#6e6e73' }}>SSH commands and portal details for this TP-Link router asset.</p>
                </div>
                <button className="btn-secondary btn-sm" onClick={() => setShowSetup(null)}>Close</button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-green-800">Bootstrap Identity</p>
                  <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                    <code className="text-xs text-gray-700 break-all flex-1">
                      {selectedRouter.provisioningKey ?? 'Router record without provisioning key'}
                    </code>
                    {selectedRouter.provisioningKey && (
                      <button
                        className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                        onClick={() => copyText(selectedRouter.provisioningKey!, 'Provisioning key')}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-green-700">
                    This key is the router asset identity. The device contacts TRIVA with this identity; no inbound reachability to the router is assumed.
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-1 text-xs text-gray-600">
                  <p className="font-semibold text-amber-800 mb-1.5">Provisioning notes</p>
                  <p>① Assigned control-plane IP: <strong>{selectedRouter.ipAddress}</strong></p>
                  <p>② Router runtime info endpoint: <strong>{selectedRouter.provisioningKey ? getBootstrapInfoUrl(selectedRouter) : 'Unavailable'}</strong></p>
                  <p>③ TRIVA only needs outbound internet from the router. No port-forwarded SSH is assumed.</p>
                  <p>④ The router must run OpenWrt; the bootstrap installs nodogsplash automatically via opkg.</p>
                  <p>⑤ If the captive portal opens but shows Service Unavailable or Network Error, re-run the bootstrap and verify the walled garden below.</p>
                </div>
              </div>

              <div className="text-xs text-gray-600 space-y-1 bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="font-semibold text-blue-800 mb-1.5">What the bootstrap installs</p>
                <p>① The nodogsplash captive portal on the LAN bridge</p>
                <p>② A recurring heartbeat to keep this asset online in the dashboard</p>
                <p>③ A recurring session-sync job (every 15s) so paid sessions go live without inbound NAT reachability</p>
                <p>④ A session-expiry sweeper that disconnects clients when their time runs out</p>
                <p>⑤ The walled garden for pandabus.live, triva.pandabus.live, mongike.com, and *.mongike.com</p>
              </div>

              <div className="text-xs text-gray-600 space-y-1 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="font-semibold text-slate-800 mb-1.5">Complete setup flow</p>
                <p>① Verify the hardware revision supports OpenWrt, then flash OpenWrt (see notice above).</p>
                <p>② Give the router working internet on its WAN port and confirm DNS works.</p>
                <p>③ SSH into the router (default <strong>ssh root@192.168.1.1</strong>) and run the preflight checks below.</p>
                <p>④ Run the bootstrap install commands once.</p>
                <p>⑤ Run verification commands and confirm triva cron jobs + nodogsplash are running.</p>
                <p>⑥ Connect a client to the WiFi, open the portal, make a payment, and confirm access goes live after sync.</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs" style={{ color: '#6e6e73' }}>Step 1: Preflight checks before bootstrap</p>
                    <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => copyText(getPreflightCommands(selectedRouter), 'Preflight commands')}>Copy commands</button>
                  </div>
                  <pre className="rounded-2xl px-4 py-4 overflow-x-auto text-[12px] leading-6 whitespace-pre-wrap" style={{ background: '#111111', color: '#f5f5f7' }}>{getPreflightCommands(selectedRouter)}</pre>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs" style={{ color: '#6e6e73' }}>Step 2: Run bootstrap install commands over SSH</p>
                    <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => copyText(getBootstrapInstallCommands(selectedRouter), 'Bootstrap commands')}>Copy commands</button>
                  </div>
                  <pre className="rounded-2xl px-4 py-4 overflow-x-auto text-[12px] leading-6 whitespace-pre-wrap" style={{ background: '#111111', color: '#f5f5f7' }}>{getBootstrapInstallCommands(selectedRouter)}</pre>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs" style={{ color: '#6e6e73' }}>Step 3: Verify cron jobs + captive portal after install</p>
                    <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => copyText(getVerificationCommands(), 'Verification commands')}>Copy commands</button>
                  </div>
                  <pre className="rounded-2xl px-4 py-4 overflow-x-auto text-[12px] leading-6 whitespace-pre-wrap" style={{ background: '#111111', color: '#f5f5f7' }}>{getVerificationCommands()}</pre>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs" style={{ color: '#6e6e73' }}>Step 4: Recovery commands if portal is up but flow is broken</p>
                    <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => copyText(getRecoveryCommands(selectedRouter), 'Recovery commands')}>Copy commands</button>
                  </div>
                  <pre className="rounded-2xl px-4 py-4 overflow-x-auto text-[12px] leading-6 whitespace-pre-wrap" style={{ background: '#111111', color: '#f5f5f7' }}>{getRecoveryCommands(selectedRouter)}</pre>
                </div>
              </div>

              <div className="text-xs text-gray-600 space-y-1 bg-rose-50 border border-rose-100 rounded-xl p-4">
                <p className="font-semibold text-rose-800 mb-1.5">Critical buy-flow hosts that must stay reachable before login</p>
                <p>① pandabus.live</p>
                <p>② triva.pandabus.live</p>
                <p>③ mongike.com</p>
                <p>④ *.mongike.com</p>
              </div>

              <div>
                <p className="text-xs mb-2" style={{ color: '#6e6e73' }}>Portal URL for this router</p>
                <div className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: '#f5f5f7', border: '1px solid #e8e8ed' }}>
                  <code className="text-xs break-all flex-1" style={{ color: '#1d1d1f' }}>
                    {`${PORTAL_BASE}/?router=${selectedRouter.id}`}
                  </code>
                  <button
                    className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                    onClick={() => copyText(`${PORTAL_BASE}/?router=${selectedRouter.id}`, 'Portal URL')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
