import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { TrendingUp, Wifi, Users, CreditCard, CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { formatTZS } from '../../utils/currency';
import { useT } from '../../i18n';
import { PageHeader, StatCard, EmptyState, Skeleton, BarChart } from '../../components/ui';

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
  router: { name: string } | null;
  tplinkRouter?: { name: string } | null;
  omadaSite?: { name: string } | null;
  startsAt: string;
  expiresAt: string;
}

interface PaymentRow { amount: number | string; status: string; createdAt: string }

interface Setup { router: boolean; plan: boolean; portal: boolean; payment: boolean }

export default function MerchantDashboard() {
  const { user } = useAuthStore();
  const { socket } = useSocketStore();
  const t = useT();
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [summaryRes, sessionsRes, paymentsRes, routersRes, plansRes, portalRes, payCfgRes] = await Promise.allSettled([
          api.get<{ data: EarningsSummary }>('/payments/earnings'),
          api.get<{ data: Session[] }>('/sessions?status=ACTIVE&limit=10'),
          api.get<{ data: PaymentRow[] }>('/payments?page=1&limit=100'),
          api.get<{ data: unknown[] }>('/routers'),
          api.get<{ data: unknown[] }>('/plans'),
          api.get<{ data: { portalNoticeName: string | null; portalNoticeMessage: string | null } }>('/portal-settings'),
          api.get<{ data: { configured?: boolean; enabled?: boolean } }>('/payment-settings'),
        ]);
        if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.data.data);
        if (sessionsRes.status === 'fulfilled') setActiveSessions(sessionsRes.value.data.data);
        if (paymentsRes.status === 'fulfilled') setPayments(paymentsRes.value.data.data);
        setSetup({
          router: routersRes.status === 'fulfilled' && routersRes.value.data.data.length > 0,
          plan: plansRes.status === 'fulfilled' && plansRes.value.data.data.length > 0,
          portal: portalRes.status === 'fulfilled' && Boolean(portalRes.value.data.data.portalNoticeName || portalRes.value.data.data.portalNoticeMessage),
          payment: payCfgRes.status === 'fulfilled' && Boolean(payCfgRes.value.data.data.configured && payCfgRes.value.data.data.enabled),
        });
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
        setSummary((prev) => (prev ? { ...prev, activeSessions: prev.activeSessions + 1 } : prev));
      });
    };
    const handleSessionExpired = () => {
      setSummary((prev) => (prev ? { ...prev, activeSessions: Math.max(0, prev.activeSessions - 1) } : prev));
    };
    socket.on('session:activated', handleSessionActivated);
    socket.on('session:expired', handleSessionExpired);
    return () => {
      socket.off('session:activated', handleSessionActivated);
      socket.off('session:expired', handleSessionExpired);
    };
  }, [socket]);

  // Last 7 days of completed revenue, bucketed per local day.
  const revenueByDay = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(new Date(), 6 - i)));
    return days.map((d) => ({
      label: format(d, 'EEE'),
      value: payments
        .filter((p) => p.status === 'COMPLETED' && isSameDay(new Date(p.createdAt), d))
        .reduce((sum, p) => sum + Number(p.amount), 0),
    }));
  }, [payments]);
  const revenueTrend = revenueByDay.map((d) => d.value);
  const weekTotal = revenueTrend.reduce((a, b) => a + b, 0);

  const steps = setup
    ? [
        { key: 'router', done: setup.router, label: t('dash.step.router'), to: '/routers' },
        { key: 'plan', done: setup.plan, label: t('dash.step.plan'), to: '/plans' },
        { key: 'portal', done: setup.portal, label: t('dash.step.portal'), to: '/settings' },
        { key: 'payment', done: setup.payment, label: t('dash.step.payment'), to: '/settings' },
      ]
    : [];
  const doneCount = steps.filter((s) => s.done).length;
  const showSetup = !loading && steps.length > 0 && doneCount < steps.length;

  return (
    <div className="p-4 sm:p-7 max-w-[1280px] mx-auto">
      <PageHeader
        title={t('dash.title')}
        subtitle={`${t('dash.welcome')}, ${user?.name} · ${user?.tenant?.name ?? ''}`}
      />

      {showSetup && (
        <section className="card p-5 mb-5" style={{ boxShadow: 'var(--shadow-card), inset 3px 0 0 var(--accent)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('dash.setup')}</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>{t('dash.setupHint')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{doneCount}/{steps.length}</span>
              <div className="h-1.5 w-28 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / steps.length) * 100}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  to={s.to}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
                  style={{
                    background: s.done ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'var(--surface-2)',
                    color: s.done ? 'var(--success)' : 'var(--text)',
                  }}
                >
                  {s.done ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Circle className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />}
                  <span className="flex-1 truncate">{s.label}</span>
                  {!s.done && <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label={t('dash.today')} value={formatTZS(summary?.todayEarnings ?? 0)} icon={TrendingUp} tone="blue" loading={loading} trend={revenueTrend} />
        <StatCard label={t('dash.month')} value={formatTZS(summary?.monthEarnings ?? 0)} icon={CreditCard} tone="ink" loading={loading} />
        <StatCard label={t('dash.active')} value={summary?.activeSessions ?? 0} icon={Wifi} tone="orange" hint={t('dash.live')} loading={loading} />
        <StatCard label={t('dash.total')} value={summary?.totalSessions ?? 0} icon={Users} tone="green" loading={loading} />
      </div>

      <div className="grid gap-4 mt-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-1">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('dash.trend')}</h2>
          </div>
          {loading ? <Skeleton className="h-40 w-full" /> : <BarChart data={revenueByDay} format={formatTZS} />}
          <p className="text-xs mt-4" style={{ color: 'var(--text-3)' }}>{formatTZS(weekTotal)}</p>
        </section>

        <section className="card lg:col-span-2 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('dash.activeTable')}</h2>
            <span className="badge-green">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: 'var(--success)' }} />
              {activeSessions.length} {t('common.online')}
            </span>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : activeSessions.length === 0 ? (
            <EmptyState icon={Wifi} title={t('dash.noActive')} hint={t('dash.noActiveHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {[t('dash.mac'), t('dash.plan'), t('dash.router'), t('dash.expires'), t('dash.status')].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.map((s) => (
                    <tr key={s.id} className="table-row" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--text-2)' }}>{s.macAddress}</td>
                      <td className="px-5 py-3 font-medium" style={{ color: 'var(--text)' }}>{s.plan.name}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--text)' }}>{s.router?.name ?? s.tplinkRouter?.name ?? s.omadaSite?.name ?? 'N/A'}</td>
                      <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-2)' }}>{s.expiresAt ? format(new Date(s.expiresAt), 'HH:mm') : '—'}</td>
                      <td className="px-5 py-3"><span className="badge-green">Active</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
