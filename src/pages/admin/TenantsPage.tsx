import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Plus, UserCheck, RefreshCw, KeyRound } from 'lucide-react';
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
  const [passwordTenant, setPasswordTenant] = useState<Tenant | null>(null);
  const [passwordForm, setPasswordForm] = useState({ next: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
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

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordTenant) return;

    if (passwordForm.next !== passwordForm.confirm) {
      toast.error('Passwords do not match');
      return;
    }

    setSavingPassword(true);
    try {
      await api.post(`/admin/tenants/${passwordTenant.id}/password`, {
        newPassword: passwordForm.next,
      });
      toast.success(`Password updated for ${passwordTenant.name}`);
      setPasswordTenant(null);
      setPasswordForm({ next: '', confirm: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSavingPassword(false);
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
            Tenants
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Manage all shops on the platform</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> New Tenant
        </button>
      </div>

      {showForm && (
        <div className="card p-6">
          <h2 className="font-semibold mb-5" style={{ color: '#1d1d1f' }}>Create New Tenant</h2>
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
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="btn-primary">Create Tenant</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {passwordTenant && (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <KeyRound className="w-4 h-4" style={{ color: '#aeaeb2' }} />
            <div>
              <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>
                Reset Tenant Password
              </h2>
              <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>
                Update the merchant login password for {passwordTenant.name}.
              </p>
            </div>
          </div>

          <form onSubmit={handleResetPassword} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, next: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input
                type="password"
                className="input"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="btn-primary" disabled={savingPassword}>
                {savingPassword ? 'Updating…' : 'Update Password'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPasswordTenant(null);
                  setPasswordForm({ next: '', confirm: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="spinner" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid #f0f0f5' }}>
                  <th className="w-[34%] px-3 py-2 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Shop</th>
                  <th className="w-[22%] px-3 py-2 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Subscription</th>
                  <th className="w-[10%] px-3 py-2 text-center text-xs font-medium" style={{ color: '#aeaeb2' }}>Routers</th>
                  <th className="w-[14%] px-3 py-2 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Status</th>
                  <th className="w-[20%] px-3 py-2 text-right text-xs font-medium" style={{ color: '#aeaeb2' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr
                    key={t.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid #f7f7f9' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td className="px-3 py-3 align-top">
                      <div className="min-w-0">
                        <p className="truncate font-medium" style={{ color: '#1d1d1f' }} title={t.name}>
                          {t.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px]" style={{ color: '#6e6e73' }} title={t.email}>
                          {t.email}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="min-w-0">
                        <p className="font-medium text-xs" style={{ color: '#3a3a3c' }}>
                          {t.subscription?.plan ?? 'No plan'}
                        </p>
                        <p className="mt-0.5 text-[11px]" style={{ color: '#6e6e73' }}>
                          {t.subscription ? `Expires ${format(new Date(t.subscription.expiresAt), 'MMM d')}` : 'Not subscribed'}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top text-center text-xs" style={{ color: '#3a3a3c' }}>{t._count.routers}</td>
                    <td className="px-3 py-3 align-top">
                      <span className={t.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}>{t.status}</span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          className="btn-secondary btn-sm whitespace-nowrap px-2 text-xs"
                          onClick={() => handleToggleStatus(t)}
                          title={t.status === 'ACTIVE' ? 'Suspend tenant' : 'Activate tenant'}
                        >
                          <UserCheck className="w-3 h-3" />
                          {t.status === 'ACTIVE' ? 'Pause' : 'Enable'}
                        </button>
                        <button
                          className="btn-secondary btn-sm whitespace-nowrap px-2 text-xs"
                          onClick={() => handleRenew(t.id)}
                          title="Renew subscription"
                        >
                          <RefreshCw className="w-3 h-3" /> Renew
                        </button>
                        <button
                          className="btn-secondary btn-sm whitespace-nowrap px-2 text-xs"
                          onClick={() => {
                            setPasswordTenant(t);
                            setPasswordForm({ next: '', confirm: '' });
                          }}
                          title="Reset tenant password"
                        >
                          <KeyRound className="w-3 h-3" /> Reset
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
