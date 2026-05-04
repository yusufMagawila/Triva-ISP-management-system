import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import {
  TrendingUp,
  Wifi,
  Users,
  CreditCard,
  Router,
  Activity,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatTZS } from '../../utils/currency';
import { format } from 'date-fns';

interface EarningsSummary {
  todayEarnings: number;
  monthEarnings: number;
  totalSessions: number;
  activeSessions: number;
}

interface Session {
  id: string;
  macAddress: string;
  status: string;
  plan: { name: string };
  router: { name: string };
  startsAt: string;
  expiresAt: string;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  sub?: string;
}

function StatCard({ title, value, icon: Icon, color, sub }: StatCardProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-1">{title}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MerchantDashboard() {
  const { user } = useAuthStore();
  const { socket } = useSocketStore();
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [summaryRes, sessionsRes] = await Promise.all([
          api.get<{ data: EarningsSummary }>('/payments/earnings'),
          api.get<{ data: Session[] }>('/sessions?status=ACTIVE&limit=10'),
        ]);
        setSummary(summaryRes.data.data);
        setActiveSessions(sessionsRes.data.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Real-time updates
  useEffect(() => {
    if (!socket) return;

    const handleSessionActivated = () => {
      // Refresh active sessions
      api.get<{ data: Session[] }>('/sessions?status=ACTIVE&limit=10').then((res) => {
        setActiveSessions(res.data.data);
        setSummary((prev) =>
          prev ? { ...prev, activeSessions: prev.activeSessions + 1 } : prev
        );
      });
    };

    const handleSessionExpired = () => {
      setSummary((prev) =>
        prev ? { ...prev, activeSessions: Math.max(0, prev.activeSessions - 1) } : prev
      );
    };

    socket.on('session:activated', handleSessionActivated);
    socket.on('session:expired', handleSessionExpired);

    return () => {
      socket.off('session:activated', handleSessionActivated);
      socket.off('session:expired', handleSessionExpired);
    };
  }, [socket]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const sub = user?.tenant?.subscription;
  const isTrialOrExpiring =
    sub &&
    (sub.status === 'TRIAL' ||
      new Date(sub.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-0.5">
          Welcome back, {user?.name} · {user?.tenant?.name}
        </p>
      </div>

      {/* Subscription warning */}
      {isTrialOrExpiring && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
          <Activity className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-yellow-800">
              {sub.status === 'TRIAL' ? 'Trial Account' : 'Subscription Expiring Soon'}
            </p>
            <p className="text-sm text-yellow-700">
              Your subscription expires on {format(new Date(sub.expiresAt), 'MMM d, yyyy')}.
              Contact admin to renew.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Today's Earnings"
          value={formatTZS(summary?.todayEarnings ?? 0)}
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
        />
        <StatCard
          title="This Month"
          value={formatTZS(summary?.monthEarnings ?? 0)}
          icon={CreditCard}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          title="Active Sessions"
          value={summary?.activeSessions ?? 0}
          icon={Wifi}
          color="bg-purple-100 text-purple-600"
          sub="Live connections"
        />
        <StatCard
          title="Total Sessions"
          value={summary?.totalSessions ?? 0}
          icon={Users}
          color="bg-orange-100 text-orange-600"
        />
      </div>

      {/* Active Sessions Table */}
      <div className="card">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Active Sessions</h2>
          <span className="badge-green">{activeSessions.length} online</span>
        </div>
        {activeSessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Wifi className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No active sessions</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">MAC Address</th>
                  <th className="px-5 py-3 text-left">Plan</th>
                  <th className="px-5 py-3 text-left">Router</th>
                  <th className="px-5 py-3 text-left">Expires</th>
                  <th className="px-5 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSessions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs">{s.macAddress}</td>
                    <td className="px-5 py-3">{s.plan.name}</td>
                    <td className="px-5 py-3">{s.router.name}</td>
                    <td className="px-5 py-3 text-xs">
                      {s.expiresAt ? format(new Date(s.expiresAt), 'HH:mm') : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className="badge-green">Active</span>
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
