import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Router, Plus, Wifi, WifiOff, RefreshCw, Trash2, Activity } from 'lucide-react';
import { format } from 'date-fns';

interface RouterData {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  hotspotName: string;
  location: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastSeenAt: string | null;
  _count: { sessions: number };
}

export default function RoutersPage() {
  const [routers, setRouters] = useState<RouterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pinging, setPinging] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    ipAddress: '',
    apiPort: 8728,
    username: '',
    password: '',
    hotspotName: 'hotspot1',
    location: '',
  });

  useEffect(() => { loadRouters(); }, []);

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
      toast.success('Router added successfully');
      setShowForm(false);
      setForm({ name: '', ipAddress: '', apiPort: 8728, username: '', password: '', hotspotName: 'hotspot1', location: '' });
      loadRouters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add router');
    }
  }

  async function handlePing(id: string) {
    setPinging(id);
    try {
      const res = await api.post<{ data: { status: string } }>(`/routers/${id}/ping`);
      setRouters((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: res.data.data.status as RouterData['status'] } : r))
      );
      toast.success(`Router is ${res.data.data.status}`);
    } catch {
      toast.error('Ping failed');
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
          <p className="text-gray-500 mt-0.5">Manage your MikroTik routers</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add Router
        </button>
      </div>

      {/* Add Router Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Add New Router</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Router Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Main Router" />
            </div>
            <div>
              <label className="label">IP Address</label>
              <input className="input" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} required placeholder="192.168.1.1" />
            </div>
            <div>
              <label className="label">API Port</label>
              <input type="number" className="input" value={form.apiPort} onChange={(e) => setForm({ ...form, apiPort: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="label">Hotspot Server Name</label>
              <input className="input" value={form.hotspotName} onChange={(e) => setForm({ ...form, hotspotName: e.target.value })} placeholder="hotspot1" />
            </div>
            <div>
              <label className="label">Username</label>
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required placeholder="admin" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <label className="label">Location (optional)</label>
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Shop floor, 2nd floor..." />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="btn-primary">Add Router</button>
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
          <p className="font-medium">No routers added yet</p>
          <p className="text-sm">Add your first MikroTik router to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {routers.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{r.ipAddress}:{r.apiPort}</p>
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

              <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                <Activity className="w-3.5 h-3.5" />
                <span>{r._count.sessions} total sessions</span>
                {r.lastSeenAt && (
                  <span>· Last seen {format(new Date(r.lastSeenAt), 'MMM d HH:mm')}</span>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  className="btn-secondary btn-sm flex-1"
                  onClick={() => handlePing(r.id)}
                  disabled={pinging === r.id}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${pinging === r.id ? 'animate-spin' : ''}`} />
                  Ping
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
      )}
    </div>
  );
}
