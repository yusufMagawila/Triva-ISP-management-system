import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import {
  TrendingUp,
  Wifi,
  Users,
  CreditCard,
  Activity,
} from 'lucide-react';
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
  accent: string;
  sub?: string;
}

function StatCard({ title, value, icon: Icon, accent, sub }: StatCardProps) {
  return (
    <div className="card p-6">
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
      {sub && <p className="text-xs mt-0.5" style={{ color: '#6e6e73' }}>{sub}</p>}
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

  useEffect(() => {
    if (!socket) return;

    const handleSessionActivated = () => {
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
        <div className="spinner" />
      </div>
    );
  }

  const sub = user?.tenant?.subscription;
  const isTrialOrExpiring =
    sub &&
    new Date(sub.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;

  return (
    <div className="p-7 space-y-6">
      {/* Header */}
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
        >
          Dashboard
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>
          Welcome back, {user?.name} · {user?.tenant?.name}
        </p>
      </div>

      {/* Subscription warning */}
      {isTrialOrExpiring && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
        >
          <Activity className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
          <div>
            <p className="font-medium text-sm" style={{ color: '#92400e' }}>
              Subscription Expiring Soon
            </p>
            <p className="text-sm" style={{ color: '#b45309' }}>
              Your subscription expires on {format(new Date(sub.expiresAt), 'MMM d, yyyy')}. Contact admin to renew.
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
          accent="#34c759"
        />
        <StatCard
          title="This Month"
          value={formatTZS(summary?.monthEarnings ?? 0)}
          icon={CreditCard}
          accent="#0071e3"
        />
        <StatCard
          title="Active Sessions"
          value={summary?.activeSessions ?? 0}
          icon={Wifi}
          accent="#af52de"
          sub="Live connections"
        />
        <StatCard
          title="Total Sessions"
          value={summary?.totalSessions ?? 0}
          icon={Users}
          accent="#ff9500"
        />
      </div>

      {/* Active Sessions Table */}
      <div className="card">
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid #f0f0f5' }}
        >
          <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Active Sessions</h2>
          <span className="badge-green">{activeSessions.length} online</span>
        </div>
        {activeSessions.length === 0 ? (
          <div className="p-12 text-center">
            <Wifi className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: '#6e6e73' }} />
            <p className="text-sm" style={{ color: '#aeaeb2' }}>No active sessions</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #f0f0f5' }}>
                  <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>MAC Address</th>
                  <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Plan</th>
                  <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Router</th>
                  <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Expires</th>
                  <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((s) => (
                  <tr
                    key={s.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid #f7f7f9' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td className="px-6 py-3.5 font-mono text-xs" style={{ color: '#3a3a3c' }}>{s.macAddress}</td>
                    <td className="px-6 py-3.5" style={{ color: '#1d1d1f' }}>{s.plan.name}</td>
                    <td className="px-6 py-3.5" style={{ color: '#1d1d1f' }}>{s.router.name}</td>
                    <td className="px-6 py-3.5 text-xs" style={{ color: '#6e6e73' }}>
                      {s.expiresAt ? format(new Date(s.expiresAt), 'HH:mm') : '—'}
                    </td>
                    <td className="px-6 py-3.5">
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


