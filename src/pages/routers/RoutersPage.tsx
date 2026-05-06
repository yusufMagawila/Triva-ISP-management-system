import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Router, Plus, Wifi, WifiOff, RefreshCw, Trash2, Activity, Copy, Info } from 'lucide-react';
import { format } from 'date-fns';

const PORTAL_BASE = 'https://pandabus.live/captive-portal';
const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

interface RouterData {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  provisioningKey: string | null;
  serialNumber: string | null;
  hardwareMac: string | null;
  hotspotName: string;
  location: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastSeenAt: string | null;
  lastBootstrapAt: string | null;
  provisionedAt: string | null;
  _count: { sessions: number };
}

export default function RoutersPage() {
  const [routers, setRouters] = useState<RouterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pinging, setPinging] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    serialNumber: '',
    hardwareMac: '',
    hotspotName: 'hotspot1',
    location: '',
  });

  const [showSetup, setShowSetup] = useState<string | null>(null);

  useEffect(() => { loadRouters(); }, []);

  function copyText(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  function getBootstrapScriptUrl(router: RouterData) {
    if (!router.provisioningKey) return '';
    return `${API_BASE}/bootstrap/router/${encodeURIComponent(router.provisioningKey)}`;
  }

  function getBootstrapInfoUrl(router: RouterData) {
    if (!router.provisioningKey) return '';
    return `${API_BASE}/bootstrap/router/${encodeURIComponent(router.provisioningKey)}/info`;
  }

  function getBootstrapInstallCommands(router: RouterData) {
    const bootstrapUrl = getBootstrapScriptUrl(router);
    if (!bootstrapUrl) return 'Provisioning key missing. Recreate or migrate this router asset.';

    return [
      `:local bootstrapUrl "${bootstrapUrl}"`,
      '/tool fetch url=$bootstrapUrl dst-path="triva-bootstrap.rsc" keep-result=yes check-certificate=no',
      '/import file-name="triva-bootstrap.rsc"',
    ].join('\n');
  }

  function getBootstrapVerificationCommands() {
    return [
      '/user print where name="triva-agent"',
      '/system script print where name~"triva"',
      '/system scheduler print where name~"triva"',
      '/ip hotspot walled-garden print where comment~"TRIVA bootstrap"',
      '/ip hotspot walled-garden ip print where comment~"TRIVA bootstrap"',
      '/ip service print where name="api"',
    ].join('\n');
  }

  function getBootstrapRecoveryCommands(router: RouterData) {
    const bootstrapUrl = getBootstrapScriptUrl(router);
    if (!bootstrapUrl) return 'Provisioning key missing. Recreate or migrate this router asset.';

    return [
      '/system script run triva-heartbeat',
      '/system script run triva-sync',
      `/tool fetch url="${bootstrapUrl}" dst-path="triva-bootstrap.rsc" keep-result=yes check-certificate=no`,
      '/import file-name="triva-bootstrap.rsc"',
    ].join('\n');
  }

  async function loadRouters() {
    try {
      const res = await api.get<{ data: RouterData[] }>('/routers');
      setRouters(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/routers', form);
      toast.success('Router asset created');
      setShowForm(false);
      setForm({ name: '', serialNumber: '', hardwareMac: '', hotspotName: 'hotspot1', location: '' });
      loadRouters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add router');
    }
  }

  async function handlePing(id: string) {
    setPinging(id);
    try {
      const res = await api.post<{ data: { status: string; lastBootstrapAt: string | null } }>(`/routers/${id}/ping`);
      setRouters((prev) =>
        prev.map((r) => (
          r.id === id
            ? {
                ...r,
                status: res.data.data.status as RouterData['status'],
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
      await api.delete(`/routers/${id}`);
      setRouters((prev) => prev.filter((r) => r.id !== id));
      toast.success('Router deleted');
    } catch {
      toast.error('Failed to delete router');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Routers</h1>
          <p className="text-gray-500 mt-0.5">Create zero-touch router assets and let each device self-provision from TRIVA</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Router
        </button>
      </div>

      {/* Add Router Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Create Router Asset</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Router Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Main Router" />
            </div>
            <div>
              <label className="label">Hotspot Server Name</label>
              <input className="input" value={form.hotspotName} onChange={(e) => setForm({ ...form, hotspotName: e.target.value })} placeholder="hotspot1" />
              <p className="text-xs text-gray-500 mt-1">TRIVA stores the hotspot server identity here and delivers the runtime sync stage from the bootstrap service.</p>
            </div>
            <div>
              <label className="label">Serial Number (optional)</label>
              <input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="AA12BC34DD56" />
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
            <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              TRIVA now assigns the control-plane IP, API account, and bootstrap identity automatically. The router must reach <span className="font-semibold">{API_BASE}/bootstrap/router</span> on its own; no public Winbox or forwarded API port is assumed.
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
          <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
        </div>
      ) : routers.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Router className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No router assets yet</p>
          <p className="text-sm">Create the first router asset, then let the device self-provision from TRIVA</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {routers.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Control plane {r.ipAddress}:{r.apiPort}</p>
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
                <p className="text-xs text-gray-500 mb-3">📍 {r.location}</p>
              )}

              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <p className="font-medium text-gray-800">{r.provisionedAt ? 'Provisioned asset' : 'Awaiting first bootstrap'}</p>
                <p className="mt-1">Hotspot: {r.hotspotName}</p>
                <p className="mt-1">Serial: {r.serialNumber ?? 'Will bind on first contact'}</p>
                <p className="mt-1">MAC: {r.hardwareMac ?? 'Will bind on first contact'}</p>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                <Activity className="w-3.5 h-3.5" />
                <span>{r._count.sessions} total sessions</span>
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

              {/* Zero-touch provisioning details */}
              {showSetup === r.id && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-brand-500" />
                    Zero-Touch Provisioning
                  </p>

                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-green-800">Bootstrap Identity</p>
                    <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                      <code className="text-xs text-gray-700 break-all flex-1">
                        {r.provisioningKey ?? 'Legacy router record without provisioning key'}
                      </code>
                      {r.provisioningKey && (
                        <button
                          className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                          onClick={() => copyText(r.provisioningKey!, 'Provisioning key')}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-green-700">
                      This key is the router asset identity. The device must contact TRIVA with this identity instead of depending on a reachable LAN or public API address.
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Bootstrap endpoint for the router:</p>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <code className="text-xs text-gray-700 break-all flex-1">
                        {r.provisioningKey ? getBootstrapScriptUrl(r) : 'Provisioning key missing. Recreate or migrate this router asset.'}
                      </code>
                      {r.provisioningKey && (
                        <button
                          className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                          onClick={() => copyText(getBootstrapScriptUrl(r), 'Bootstrap URL')}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-gray-600 space-y-1 bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <p className="font-semibold text-blue-800 mb-1.5">What the bootstrap stage installs:</p>
                    <p>① The TRIVA-managed API account on the router</p>
                    <p>② A recurring heartbeat to keep this asset online in the dashboard</p>
                    <p>③ A recurring session-sync job so paid sessions go live without inbound NAT reachability</p>
                    <p>④ The TRIVA captive portal files when the hotspot directory exists</p>
                    <p>⑤ The hotspot allow-list for pandabus.live, triva.pandabus.live, mongike.com, and *.mongike.com</p>
                    <p className="text-blue-700 mt-2">This is the supported onboarding path now. The dashboard no longer distributes per-router installer or manual packs.</p>
                  </div>

                  <div className="text-xs text-gray-600 space-y-1 bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <p className="font-semibold text-amber-800 mb-1.5">Provisioning notes:</p>
                    <p>① Assigned control-plane IP: <strong>{r.ipAddress}</strong></p>
                    <p>② Hotspot server stored for this asset: <strong>{r.hotspotName}</strong></p>
                    <p>③ Router runtime info endpoint: <strong>{r.provisioningKey ? getBootstrapInfoUrl(r) : 'Unavailable'}</strong></p>
                    <p>④ TRIVA only needs outbound internet from the router. No port-forwarded API is assumed.</p>
                    <p>⑤ If the captive portal opens but shows Service Unavailable or Network Error, re-import bootstrap and verify the hotspot allow-list below.</p>
                    <p className="text-amber-700 mt-2">Shop flow: create the asset, import bootstrap, verify heartbeat plus allow-list, then test a real payment from a client device.</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs text-gray-500">Run these commands on the MikroTik terminal:</p>
                      <button
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        onClick={() => copyText(getBootstrapInstallCommands(r), 'Bootstrap commands')}
                      >
                        Copy commands
                      </button>
                    </div>
                    <pre className="bg-gray-950 text-gray-100 text-[11px] leading-5 rounded-lg px-3 py-3 overflow-x-auto whitespace-pre-wrap">{getBootstrapInstallCommands(r)}</pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs text-gray-500">Verify the router after import:</p>
                      <button
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        onClick={() => copyText(getBootstrapVerificationCommands(), 'Verification commands')}
                      >
                        Copy commands
                      </button>
                    </div>
                    <pre className="bg-gray-950 text-gray-100 text-[11px] leading-5 rounded-lg px-3 py-3 overflow-x-auto whitespace-pre-wrap">{getBootstrapVerificationCommands()}</pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs text-gray-500">Recovery commands if clients hit Service Unavailable or Network Error:</p>
                      <button
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        onClick={() => copyText(getBootstrapRecoveryCommands(r), 'Recovery commands')}
                      >
                        Copy commands
                      </button>
                    </div>
                    <pre className="bg-gray-950 text-gray-100 text-[11px] leading-5 rounded-lg px-3 py-3 overflow-x-auto whitespace-pre-wrap">{getBootstrapRecoveryCommands(r)}</pre>
                  </div>

                  <div className="text-xs text-gray-600 space-y-1 bg-rose-50 border border-rose-100 rounded-lg p-3">
                    <p className="font-semibold text-rose-800 mb-1.5">Critical buy-flow hosts that must stay reachable before login:</p>
                    <p>① pandabus.live</p>
                    <p>② triva.pandabus.live</p>
                    <p>③ mongike.com</p>
                    <p>④ *.mongike.com</p>
                    <p className="text-rose-700 mt-2">Bootstrap now installs these rules automatically so the portal UI can load plans, start payments, and keep the paid-session flow alive.</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Portal URL for your custom HotSpot redirect page:</p>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <code className="text-xs text-gray-700 break-all flex-1">
                        {`${PORTAL_BASE}/?router=${r.id}`}
                      </code>
                      <button
                        className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                        onClick={() => copyText(`${PORTAL_BASE}/?router=${r.id}`, 'Portal URL')}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
