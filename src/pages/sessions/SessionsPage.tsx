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
  router: { name: string };
}

const statusColors: Record<string, string> = {
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <p className="text-gray-500 mt-0.5">Monitor all WiFi sessions</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'ACTIVE', 'PENDING', 'EXPIRED', 'DISCONNECTED'].map((s) => (
          <button
            key={s}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No sessions found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">MAC Address</th>
                    <th className="px-5 py-3 text-left">Plan</th>
                    <th className="px-5 py-3 text-left">Router</th>
                    <th className="px-5 py-3 text-left">Started</th>
                    <th className="px-5 py-3 text-left">Expires</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-mono text-xs">{s.macAddress}</td>
                      <td className="px-5 py-3">{s.plan.name}</td>
                      <td className="px-5 py-3">{s.router.name}</td>
                      <td className="px-5 py-3 text-xs">
                        {s.startsAt ? format(new Date(s.startsAt), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {s.expiresAt ? format(new Date(s.expiresAt), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={statusColors[s.status] ?? 'badge-gray'}>{s.status}</span>
                      </td>
                      <td className="px-5 py-3">
                        {s.status === 'ACTIVE' && (
                          <button
                            className="text-red-400 hover:text-red-600 transition-colors"
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
              <div className="p-4 flex items-center justify-between border-t border-gray-100">
                <p className="text-sm text-gray-500">{total} total sessions</p>
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
