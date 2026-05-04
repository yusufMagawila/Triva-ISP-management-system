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
        <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const statCards = [
    { title: 'Total Tenants', value: stats?.totalTenants ?? 0, icon: Building2, color: 'bg-blue-100 text-blue-600' },
    { title: 'Total Users', value: stats?.totalUsers ?? 0, icon: Users, color: 'bg-purple-100 text-purple-600' },
    { title: 'Active Sessions', value: stats?.activeSessions ?? 0, icon: Activity, color: 'bg-green-100 text-green-600' },
    { title: "Today's Revenue", value: `TZS ${Number(stats?.todayRevenue ?? 0).toLocaleString()}`, icon: TrendingUp, color: 'bg-orange-100 text-orange-600' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500 mt-0.5">Platform-wide overview</p>
      </div>

      {stats?.subscriptionsExpiringSoon ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-800">
            <strong>{stats.subscriptionsExpiringSoon}</strong> tenant subscriptions are expiring within 7 days.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(({ title, value, icon: Icon, color }) => (
          <div key={title} className="card p-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${color}`}>
              <Icon className="w-6 h-6" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{title}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Tenants</h2>
        </div>
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
