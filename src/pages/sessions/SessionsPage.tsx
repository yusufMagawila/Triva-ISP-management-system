import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Activity, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useSocketStore } from '../../store/socketStore';

interface Session {
  id: string;
  macAddress: string;
  ipAddress: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED';
  startsAt: string | null;
  expiresAt: string | null;
  plan: { name: string };
  router: { name: string } | null;
  tplinkRouter?: { name: string } | null;
  omadaSite?: { name: string } | null;
}

const statusBadge: Record<string, string> = {
  ACTIVE: 'badge-green',
  PENDING: 'badge-yellow',
  EXPIRED: 'badge-gray',
  DISCONNECTED: 'badge-red',
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { socket } = useSocketStore();

  useEffect(() => { loadSessions(); }, [statusFilter, page]);

  useEffect(() => {
    if (!socket) return;
    socket.on('session:activated', () => loadSessions());
    socket.on('session:expired', () => loadSessions());
    return () => {
      socket.off('session:activated');
      socket.off('session:expired');
    };
  }, [socket]);

  async function loadSessions() {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<{ data: Session[]; pagination: { total: number } }>(`/sessions?${params}`);
      setSessions(res.data.data);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this session?')) return;
    try {
      await api.post(`/sessions/${id}/disconnect`);
      toast.success('Session disconnected');
      loadSessions();
    } catch {
      toast.error('Failed to disconnect session');
    }
  }

  return (
    <div className="p-4 sm:p-7 space-y-6 max-w-[1280px] mx-auto">
      <div>
        <h1
          className="text-[22px] sm:text-2xl font-semibold tracking-tight"
          style={{ color: 'var(--text)', letterSpacing: '-0.03em' }}
        >
          Sessions
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>Monitor all WiFi sessions</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'ACTIVE', 'PENDING', 'EXPIRED', 'DISCONNECTED'].map((s) => (
          <button
            key={s}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === s ? 'text-white' : 'bg-white border hover:bg-gray-50'
            }`}
            style={
              statusFilter === s
                ? { background: 'var(--primary)', border: '1px solid #0071e3', color: 'white' }
                : { border: '1px solid var(--border-strong)', color: 'var(--text)' }
            }
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="spinner" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-16 text-center">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: 'var(--text-2)' }} />
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No sessions found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>MAC Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Router</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Started</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Expires</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td className="px-6 py-3.5 font-mono text-xs" style={{ color: 'var(--text)' }}>{s.macAddress}</td>
                      <td className="px-6 py-3.5" style={{ color: 'var(--text)' }}>{s.plan.name}</td>
                      <td className="px-6 py-3.5" style={{ color: 'var(--text)' }}>{s.router?.name ?? s.tplinkRouter?.name ?? s.omadaSite?.name ?? 'N/A'}</td>
                      <td className="px-6 py-3.5 text-xs" style={{ color: 'var(--text-2)' }}>
                        {s.startsAt ? format(new Date(s.startsAt), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-6 py-3.5 text-xs" style={{ color: 'var(--text-2)' }}>
                        {s.expiresAt ? format(new Date(s.expiresAt), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={statusBadge[s.status] ?? 'badge-gray'}>{s.status}</span>
                      </td>
                      <td className="px-6 py-3.5">
                        {s.status === 'ACTIVE' && (
                          <button
                            className="transition-colors hover:text-red-500"
                            style={{ color: 'var(--text-3)' }}
                            onClick={() => handleDisconnect(s.id)}
                            title="Disconnect"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 20 && (
              <div
                className="px-6 py-4 flex items-center justify-between"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>{total} total sessions</p>
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <button className="btn-secondary btn-sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


interface Session {
  id: string;
  macAddress: string;
  ipAddress: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED';
  startsAt: string | null;
  expiresAt: string | null;
  plan: { name: string };
  router: { name: string } | null;
  tplinkRouter?: { name: string } | null;
  omadaSite?: { name: string } | null;
}

const statusColors: Record<string, string> = {
  ACTIVE: 'badge-green',
  PENDING: 'badge-yellow',
  EXPIRED: 'badge-gray',
  DISCONNECTED: 'badge-red',
};

