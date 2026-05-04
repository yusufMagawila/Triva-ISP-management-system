import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Building2, Plus, UserCheck, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  subscription: { status: string; expiresAt: string; plan: string } | null;
  _count: { routers: number; sessions: number };
  createdAt: string;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', slug: '', email: '', phone: '',
    merchantName: '', merchantEmail: '', merchantPassword: '',
    subscriptionPlan: 'BASIC',
  });

  useEffect(() => { loadTenants(); }, []);

  async function loadTenants() {
    try {
      const res = await api.get<{ data: Tenant[] }>('/admin/tenants');
      setTenants(res.data.data);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/admin/tenants', form);
      toast.success('Tenant created');
      setShowForm(false);
      loadTenants();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tenant');
    }
  }

  async function handleToggleStatus(t: Tenant) {
    const newStatus = t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.patch(`/admin/tenants/${t.id}/status`, { status: newStatus });
      setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, status: newStatus } : x));
      toast.success(`Tenant ${newStatus.toLowerCase()}`);
    } catch {
      toast.error('Failed to update status');
    }
  }

  async function handleRenew(id: string) {
    try {
      await api.post(`/admin/tenants/${id}/subscription/renew`, { plan: 'STANDARD', months: 1 });
      toast.success('Subscription renewed for 1 month');
      loadTenants();
    } catch {
      toast.error('Failed to renew subscription');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-gray-500 mt-0.5">Manage all shops on the platform</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> New Tenant
        </button>
      </div>

      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Create New Tenant</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="label">Shop Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="label">Slug</label><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required placeholder="my-shop" /></div>
            <div><label className="label">Shop Email</label><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className="label">Merchant Name</label><input className="input" value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} required /></div>
            <div><label className="label">Merchant Email</label><input type="email" className="input" value={form.merchantEmail} onChange={(e) => setForm({ ...form, merchantEmail: e.target.value })} required /></div>
            <div><label className="label">Merchant Password</label><input type="password" className="input" value={form.merchantPassword} onChange={(e) => setForm({ ...form, merchantPassword: e.target.value })} required minLength={8} /></div>
            <div>
              <label className="label">Subscription Plan</label>
              <select className="input" value={form.subscriptionPlan} onChange={(e) => setForm({ ...form, subscriptionPlan: e.target.value })}>
                <option value="BASIC">Basic</option>
                <option value="STANDARD">Standard</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className="btn-primary">Create Tenant</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">Shop</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Plan</th>
                  <th className="px-5 py-3 text-left">Expires</th>
                  <th className="px-5 py-3 text-left">Routers</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium">{t.name}</td>
                    <td className="px-5 py-3 text-gray-500">{t.email}</td>
                    <td className="px-5 py-3">{t.subscription?.plan ?? '—'}</td>
                    <td className="px-5 py-3 text-xs">
                      {t.subscription ? format(new Date(t.subscription.expiresAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-5 py-3">{t._count.routers}</td>
                    <td className="px-5 py-3">
                      <span className={t.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}>{t.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2">
                        <button className="btn-secondary btn-sm" onClick={() => handleToggleStatus(t)}>
                          <UserCheck className="w-3.5 h-3.5" />
                          {t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                        <button className="btn-secondary btn-sm" onClick={() => handleRenew(t.id)}>
                          <RefreshCw className="w-3.5 h-3.5" /> Renew
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
