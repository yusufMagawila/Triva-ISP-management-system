import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatTZS } from '../../utils/currency';
import { CreditCard, Plus, Trash2, Clock, Zap } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMins: number;
  downloadKbps: number | null;
  uploadKbps: number | null;
  dataLimitMb: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${mins / 60} hr${mins / 60 > 1 ? 's' : ''}`;
  return `${mins / 1440} day${mins / 1440 > 1 ? 's' : ''}`;
}

function formatSpeed(kbps: number | null): string {
  if (!kbps) return 'Unlimited';
  if (kbps >= 1024) return `${kbps / 1024} Mbps`;
  return `${kbps} Kbps`;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    durationMins: 60,
    downloadKbps: '',
    uploadKbps: '',
  });

  useEffect(() => { loadPlans(); }, []);

  async function loadPlans() {
    try {
      const res = await api.get<{ data: Plan[] }>('/plans');
      setPlans(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/plans', {
        ...form,
        price: parseFloat(form.price),
        downloadKbps: form.downloadKbps ? parseInt(form.downloadKbps) : undefined,
        uploadKbps: form.uploadKbps ? parseInt(form.uploadKbps) : undefined,
      });
      toast.success('Plan created');
      setShowForm(false);
      setForm({ name: '', description: '', price: '', durationMins: 60, downloadKbps: '', uploadKbps: '' });
      loadPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create plan');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this plan?')) return;
    try {
      await api.delete(`/plans/${id}`);
      setPlans((prev) => prev.filter((p) => p.id !== id));
      toast.success('Plan deactivated');
    } catch {
      toast.error('Failed to deactivate plan');
    }
  }

  return (
    <div className="p-7 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
          >
            Internet Plans
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Manage WiFi plans for your customers</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold mb-5" style={{ color: '#1d1d1f' }}>Create New Plan</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Plan Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="1 Hour Access" />
            </div>
            <div>
              <label className="label">Price (TZS)</label>
              <input type="number" step="0.01" min="0" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="30" />
            </div>
            <div>
              <label className="label">Duration (minutes)</label>
              <input type="number" min="1" className="input" value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: parseInt(e.target.value) })} required />
            </div>
            <div>
              <label className="label">Description <span style={{ color: '#aeaeb2' }}>optional</span></label>
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="High speed internet..." />
            </div>
            <div>
              <label className="label">Download Speed (Kbps) <span style={{ color: '#aeaeb2' }}>blank = unlimited</span></label>
              <input type="number" min="0" className="input" value={form.downloadKbps} onChange={(e) => setForm({ ...form, downloadKbps: e.target.value })} placeholder="5120" />
            </div>
            <div>
              <label className="label">Upload Speed (Kbps) <span style={{ color: '#aeaeb2' }}>blank = unlimited</span></label>
              <input type="number" min="0" className="input" value={form.uploadKbps} onChange={(e) => setForm({ ...form, uploadKbps: e.target.value })} placeholder="2048" />
            </div>
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="btn-primary">Create Plan</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner" />
        </div>
      ) : plans.length === 0 ? (
        <div className="card p-16 text-center">
          <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#6e6e73' }} />
          <p className="text-sm" style={{ color: '#aeaeb2' }}>No plans created yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`card p-6 transition-opacity ${p.status === 'INACTIVE' ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-bold text-base" style={{ color: '#1d1d1f' }}>{p.name}</h3>
                <span
                  className="text-lg font-bold"
                  style={{ color: '#0071e3' }}
                >
                  {formatTZS(p.price)}
                </span>
              </div>
              {p.description && (
                <p className="text-xs mb-3" style={{ color: '#6e6e73' }}>{p.description}</p>
              )}
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center gap-2 text-sm" style={{ color: '#3a3a3c' }}>
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#aeaeb2' }} />
                  {formatDuration(p.durationMins)}
                </div>
                <div className="flex items-center gap-2 text-sm" style={{ color: '#3a3a3c' }}>
                  <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#aeaeb2' }} />
                  ↓ {formatSpeed(p.downloadKbps)} / ↑ {formatSpeed(p.uploadKbps)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={p.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}>
                  {p.status}
                </span>
                <div className="ml-auto">
                  <button
                    className="transition-colors hover:text-red-500"
                    style={{ color: '#aeaeb2' }}
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


