import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Wifi, WifiOff, Plus, Trash2, Activity, Copy, Info, Download, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

interface OmadaSiteData {
  id: string;
  name: string;
  controllerUrl: string | null;
  controllerIp: string | null;
  radiusSecret: string;
  ssidName: string | null;
  hotspotName: string;
  location: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastSeenAt: string | null;
  provisionedAt: string | null;
  createdAt: string;
  _count: { sessions: number; activeSessions: number };
}

export default function OmadaSitesPage() {
  const [sites, setSites] = useState<OmadaSiteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSetup, setShowSetup] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    controllerUrl: '',
    controllerIp: '',
    ssidName: '',
    location: '',
  });

  useEffect(() => { loadSites(); }, []);

  function copyText(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  async function loadSites() {
    try {
      const res = await api.get<{ data: OmadaSiteData[] }>('/omada-sites');
      setSites(res.data.data);
    } catch {
      toast.error('Failed to load Omada sites');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/omada-sites', form);
      toast.success('Omada site created');
      setShowForm(false);
      setForm({ name: '', controllerUrl: '', controllerIp: '', ssidName: '', location: '' });
      loadSites();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create site');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this Omada site? Active RADIUS users for this site will stop working.')) return;
    try {
      await api.delete(`/omada-sites/${id}`);
      setSites((prev) => prev.filter((s) => s.id !== id));
      toast.success('Site deleted');
    } catch {
      toast.error('Failed to delete site');
    }
  }

  async function handleProvision(id: string) {
    try {
      await api.post(`/omada-sites/${id}/provision`);
      toast.success('Site marked as provisioned');
      loadSites();
    } catch {
      toast.error('Failed to mark as provisioned');
    }
  }

  async function handleDownloadPortal(id: string, name: string) {
    try {
      const res = await api.get(`/omada-sites/${id}/portal-page`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `omada-portal-${name.replace(/[^a-z0-9]/gi, '-')}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Portal page downloaded');
    } catch {
      toast.error('Failed to download portal page');
    }
  }

  const selectedSite = showSetup ? sites.find((s) => s.id === showSetup) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: '#6e6e73' }}>
          Create Omada site assets and let customers self-provision via RADIUS authentication through TRIVA.
        </p>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Omada Site
        </button>
      </div>

      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
        <p className="font-semibold mb-1">TP-Link Omada Controller required</p>
        <p>Each Omada site needs an Omada Controller (OC200 hardware or Software Controller) with an adopted EAP. TRIVA generates a per-site RADIUS shared secret and a Custom Portal Page zip — no manual file editing needed.</p>
      </div>

      {/* Add Site Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold mb-5" style={{ color: '#1d1d1f' }}>Create Omada Site Asset</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Site Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Shop WiFi" />
            </div>
            <div>
              <label className="label">SSID Name (optional)</label>
              <input className="input" value={form.ssidName} onChange={(e) => setForm({ ...form, ssidName: e.target.value })} placeholder="TRIVA WiFi" />
              <p className="text-xs text-gray-500 mt-1">The WiFi name broadcast by the EAP. For reference only.</p>
            </div>
            <div>
              <label className="label">Controller URL (optional)</label>
              <input className="input" value={form.controllerUrl} onChange={(e) => setForm({ ...form, controllerUrl: e.target.value })} placeholder="https://192.168.1.100:443" />
              <p className="text-xs text-gray-500 mt-1">The Omada Controller web URL. Used for reference and redirect back after payment.</p>
            </div>
            <div>
              <label className="label">Controller IP (optional)</label>
              <input className="input" value={form.controllerIp} onChange={(e) => setForm({ ...form, controllerIp: e.target.value })} placeholder="192.168.1.100" />
              <p className="text-xs text-gray-500 mt-1">If set, only this IP can send RADIUS auth requests. Leave empty to allow any IP (wildcard).</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Location (optional)</label>
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Shop floor, 2nd floor..." />
            </div>
            <div className="md:col-span-2 rounded-xl px-4 py-3 text-sm" style={{ background: '#f0f6ff', border: '1px solid #dceeff', color: '#1d4b8a' }}>
              TRIVA generates a per-site RADIUS shared secret automatically. After creating the site, download the Custom Portal Page zip and configure the Omada Controller using the setup guide.
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="btn-primary">Create Asset</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Sites grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner" />
        </div>
      ) : sites.length === 0 ? (
        <div className="card p-16 text-center">
          <Wifi className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#6e6e73' }} />
          <p className="font-medium text-sm" style={{ color: '#3a3a3c' }}>No Omada sites yet</p>
          <p className="text-sm mt-1" style={{ color: '#aeaeb2' }}>Create the first Omada site asset, then configure the Omada Controller</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sites.map((s) => (
              <div key={s.id} className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>{s.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: '#6e6e73' }}>
                      {s.ssidName ? `SSID: ${s.ssidName}` : 'SSID not set'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {s.status === 'ONLINE' ? (
                      <Wifi className="w-4 h-4 text-green-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-red-400" />
                    )}
                    <span className={s.status === 'ONLINE' ? 'badge-green' : 'badge-red'}>
                      {s.status}
                    </span>
                  </div>
                </div>

                {s.location && (
                  <p className="text-xs mb-3" style={{ color: '#6e6e73' }}>📍 {s.location}</p>
                )}

                <div className="mb-3 rounded-xl px-3 py-2.5 text-xs" style={{ background: '#f5f5f7' }}>
                  <p className="font-semibold mb-1" style={{ color: '#1d1d1f' }}>
                    {s.provisionedAt ? 'Provisioned' : 'Awaiting Omada Controller setup'}
                  </p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>Vendor: TP-Link Omada (RADIUS)</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>Controller: {s.controllerUrl ?? 'Not set'}</p>
                  <p className="mt-1" style={{ color: '#3a3a3c' }}>RADIUS IP: {s.controllerIp ?? 'Any (wildcard)'}</p>
                </div>

                <div className="flex items-center gap-2 text-xs mb-4" style={{ color: '#6e6e73' }}>
                  <Activity className="w-3.5 h-3.5" />
                  <span>{s._count.activeSessions} active · {s._count.sessions} total</span>
                  {s.lastSeenAt && (
                    <span>· Last seen {format(new Date(s.lastSeenAt), 'MMM d HH:mm')}</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    className="btn-secondary btn-sm flex-1"
                    title="Download Custom Portal Page"
                    onClick={() => handleDownloadPortal(s.id, s.name)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Portal Zip
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    title="Setup guide"
                    onClick={() => setShowSetup(showSetup === s.id ? null : s.id)}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => handleDelete(s.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedSite && (
            <div className="card p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: '#6e6e73' }}>Omada Controller Setup</p>
                  <h2 className="text-xl font-semibold mt-1" style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}>{selectedSite.name} setup</h2>
                  <p className="text-sm mt-1" style={{ color: '#6e6e73' }}>Configure the Omada Controller using these settings.</p>
                </div>
                <button className="btn-secondary btn-sm" onClick={() => setShowSetup(null)}>Close</button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* RADIUS Configuration */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-green-800">RADIUS Server Configuration</p>
                  <p className="text-xs text-green-700">Enter these values in the Omada Controller under Settings → Authentication → RADIUS</p>

                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Server IP</p>
                      <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-gray-700 break-all flex-1">triva.pandabus.live</code>
                        <button className="flex-shrink-0 text-gray-400 hover:text-brand-600" onClick={() => copyText('triva.pandabus.live', 'Server IP')}>
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Auth Port</p>
                      <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-gray-700 flex-1">1812</code>
                        <button className="flex-shrink-0 text-gray-400 hover:text-brand-600" onClick={() => copyText('1812', 'Auth Port')}>
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Accounting Port</p>
                      <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-gray-700 flex-1">1813</code>
                        <button className="flex-shrink-0 text-gray-400 hover:text-brand-600" onClick={() => copyText('1813', 'Accounting Port')}>
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Shared Secret (generated for this site)</p>
                      <div className="flex items-center gap-2 bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-gray-700 break-all flex-1">{selectedSite.radiusSecret}</code>
                        <button className="flex-shrink-0 text-gray-400 hover:text-brand-600" onClick={() => copyText(selectedSite.radiusSecret, 'RADIUS secret')}>
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Protocol</p>
                      <div className="bg-white/80 border border-green-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-gray-700">PAP</code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Portal Page Download */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-800">Custom Portal Page</p>
                  <p className="text-xs text-blue-700">
                    Download the portal page zip and upload it to the Omada Controller under Settings → Authentication → Portal → Portal Customization.
                    The zip contains index.html + index.js with your site ID and tenant ID already configured — no manual editing needed.
                  </p>
                  <button
                    className="btn-primary w-full"
                    onClick={() => handleDownloadPortal(selectedSite.id, selectedSite.name)}
                  >
                    <Download className="w-4 h-4" />
                    Download Portal Page Zip
                  </button>
                  <p className="text-xs text-gray-500">
                    Site ID: <code className="text-xs">{selectedSite.id}</code>
                  </p>
                </div>
              </div>

              {/* Setup Steps */}
              <div className="text-xs text-gray-600 space-y-1 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="font-semibold text-slate-800 mb-1.5">Complete setup flow</p>
                <p>① Adopt the EAP603-Outdoor in the Omada Controller (Devices → Pending → Adopt).</p>
                <p>② Create a WiFi SSID with Security: Open (portal handles authentication).</p>
                <p>③ Go to Settings → Authentication → Portal. Set Authentication Type: Hotspot, Hotspot Type: RADIUS Access.</p>
                <p>④ Upload the Custom Portal Page zip (downloaded above) under Portal Customization.</p>
                <p>⑤ Go to Settings → Authentication → RADIUS. Add a RADIUS server with the values shown above.</p>
                <p>⑥ Assign the RADIUS server to the SSID's portal configuration.</p>
                <p>⑦ Apply the configuration to the EAP.</p>
                <p>⑧ Click "Mark as Provisioned" below once setup is complete.</p>
                <p>⑨ Connect a client to the SSID and test with a voucher or payment.</p>
              </div>

              {/* Portal URL */}
              <div>
                <p className="text-xs mb-2" style={{ color: '#6e6e73' }}>Captive Portal URL for this site</p>
                <div className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: '#f5f5f7', border: '1px solid #e8e8ed' }}>
                  <code className="text-xs break-all flex-1" style={{ color: '#1d1d1f' }}>
                    {`https://triva.pandabus.live/captive-portal-omada/?siteId=${selectedSite.id}`}
                  </code>
                  <button
                    className="flex-shrink-0 text-gray-400 hover:text-brand-600"
                    onClick={() => copyText(`https://triva.pandabus.live/captive-portal-omada/?siteId=${selectedSite.id}`, 'Portal URL')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Provision button */}
              {!selectedSite.provisionedAt && (
                <button
                  className="btn-primary w-full"
                  onClick={() => handleProvision(selectedSite.id)}
                >
                  <CheckCircle className="w-4 h-4" />
                  Mark as Provisioned
                </button>
              )}

              {/* Critical hosts */}
              <div className="text-xs text-gray-600 space-y-1 bg-rose-50 border border-rose-100 rounded-xl p-4">
                <p className="font-semibold text-rose-800 mb-1.5">Critical hosts that must be reachable</p>
                <p>① triva.pandabus.live (TRIVA backend + captive portal + RADIUS)</p>
                <p>② mongike.com / *.mongike.com (payment gateway — if using Mongike)</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
