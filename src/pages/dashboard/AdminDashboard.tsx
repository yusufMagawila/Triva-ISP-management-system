import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Building2, Users, Activity, TrendingUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

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

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="spinner" />
      </div>
    );
  }

  const statCards = [
    { title: 'Total Tenants', value: stats?.totalTenants ?? 0, icon: Building2, accent: '#0071e3' },
    { title: 'Total Users', value: stats?.totalUsers ?? 0, icon: Users, accent: '#af52de' },
    { title: 'Active Sessions', value: stats?.activeSessions ?? 0, icon: Activity, accent: '#34c759' },
    { title: "Today's Revenue", value: `TZS ${Number(stats?.todayRevenue ?? 0).toLocaleString()}`, icon: TrendingUp, accent: '#ff9500' },
  ];

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
        >
          Admin Dashboard
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Platform-wide overview</p>
      </div>

      {stats?.subscriptionsExpiringSoon ? (
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#d97706' }} />
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>{stats.subscriptionsExpiringSoon}</strong> tenant subscriptions are expiring within 7 days.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(({ title, value, icon: Icon, accent }) => (
          <div key={title} className="card p-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
              style={{ background: accent + '18' }}
            >
              <Icon className="w-5 h-5" style={{ color: accent }} />
            </div>
            <p
              className="text-2xl font-bold tracking-tight"
              style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
            >
              {value}
            </p>
            <p className="text-sm font-medium mt-0.5" style={{ color: '#3a3a3c' }}>{title}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #f0f0f5' }}>
          <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Recent Tenants</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f5' }}>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Shop</th>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Expires</th>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Routers</th>
                <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Status</th>
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
                  <td className="px-6 py-3.5 font-medium" style={{ color: '#1d1d1f' }}>{t.name}</td>
                  <td className="px-6 py-3.5" style={{ color: '#6e6e73' }}>{t.email}</td>
                  <td className="px-6 py-3.5" style={{ color: '#3a3a3c' }}>{t.subscription?.plan ?? '—'}</td>
                  <td className="px-6 py-3.5 text-xs" style={{ color: '#6e6e73' }}>
                    {t.subscription ? format(new Date(t.subscription.expiresAt), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="px-6 py-3.5" style={{ color: '#3a3a3c' }}>{t._count.routers}</td>
                  <td className="px-6 py-3.5">
                    <span className={t.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

