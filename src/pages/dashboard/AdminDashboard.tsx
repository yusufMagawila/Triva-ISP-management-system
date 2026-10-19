import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Building2, Users, Activity, TrendingUp, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { PageHeader, StatCard, Skeleton, EmptyState } from '../../components/ui';

interface AdminStats {
  totalTenants: number;
  totalUsers: number;
  activeSessions: number;
  todayRevenue: number;
  subscriptionsExpiringSoon: number;
}

interface Tenant {
  id: string;
  name: string;
  email: string;
  status: string;
  subscription: { status: string; expiresAt: string; plan: string } | null;
  _count: { routers: number; sessions: number };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, tenantsRes] = await Promise.all([
          api.get<{ data: AdminStats }>('/admin/stats'),
          api.get<{ data: Tenant[] }>('/admin/tenants?limit=8'),
        ]);
        setStats(statsRes.data.data);
        setTenants(tenantsRes.data.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="p-4 sm:p-7 max-w-[1280px] mx-auto">
      <PageHeader title="Platform overview" subtitle="Everything across all shops, at a glance" />

      {stats?.subscriptionsExpiringSoon ? (
        <div
          className="rounded-xl p-4 mb-5 flex items-center gap-3"
          style={{
            background: 'var(--accent-soft)',
            boxShadow: 'inset 3px 0 0 var(--accent)',
          }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            <strong>{stats.subscriptionsExpiringSoon}</strong> tenant subscriptions are expiring within 7 days.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total tenants" value={stats?.totalTenants ?? 0} icon={Building2} tone="blue" loading={loading} />
        <StatCard label="Total users" value={stats?.totalUsers ?? 0} icon={Users} tone="ink" loading={loading} />
        <StatCard label="Active sessions" value={stats?.activeSessions ?? 0} icon={Activity} tone="green" loading={loading} />
        <StatCard label="Today's revenue" value={`TZS ${Number(stats?.todayRevenue ?? 0).toLocaleString()}`} icon={TrendingUp} tone="orange" loading={loading} />
      </div>

      <section className="card mt-4 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Recent tenants</h2>
          <Link to="/tenants" className="text-xs font-semibold hover:underline" style={{ color: 'var(--primary)' }}>View all</Link>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : tenants.length === 0 ? (
          <EmptyState icon={Building2} title="No tenants yet" hint="New shops appear here as they register." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Shop', 'Email', 'Plan', 'Expires', 'Routers', 'Status'].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="table-row" style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3 font-medium" style={{ color: 'var(--text)' }}>{t.name}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-2)' }}>{t.email}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--text)' }}>{t.subscription?.plan ?? '—'}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-2)' }}>
                      {t.subscription ? format(new Date(t.subscription.expiresAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text)' }}>{t._count.routers}</td>
                    <td className="px-5 py-3">
                      <span className={t.status === 'ACTIVE' ? 'badge-green' : t.status === 'PENDING' ? 'badge-orange' : 'badge-red'}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
