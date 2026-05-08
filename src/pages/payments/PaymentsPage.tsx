import { useEffect, useState } from 'react';
import api from '../../services/api';
import { formatTZS } from '../../utils/currency';
import { CreditCard } from 'lucide-react';
import { format } from 'date-fns';

interface Payment {
  id: string;
  amount: number;
  currency: string;
  phone: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  plan: { name: string };
  createdAt: string;
  mongikeTxId: string | null;
}

const statusBadge: Record<string, string> = {
  COMPLETED: 'badge-green',
  PENDING: 'badge-yellow',
  FAILED: 'badge-red',
  REFUNDED: 'badge-gray',
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => { loadPayments(); }, [page]);

  async function loadPayments() {
    try {
      const res = await api.get<{ data: Payment[]; pagination: { total: number } }>(`/payments?page=${page}&limit=20`);
      setPayments(res.data.data);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
        >
          Payments
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Transaction history</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="spinner" />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-16 text-center">
            <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#6e6e73' }} />
            <p className="text-sm" style={{ color: '#aeaeb2' }}>No payments yet</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #f0f0f5' }}>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Phone</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Tx ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium" style={{ color: '#aeaeb2' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid #f7f7f9' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td className="px-6 py-3.5 text-xs" style={{ color: '#6e6e73' }}>
                        {format(new Date(p.createdAt), 'MMM d, HH:mm')}
                      </td>
                      <td className="px-6 py-3.5" style={{ color: '#3a3a3c' }}>{p.phone ?? '—'}</td>
                      <td className="px-6 py-3.5" style={{ color: '#1d1d1f' }}>{p.plan?.name ?? '—'}</td>
                      <td className="px-6 py-3.5 font-semibold" style={{ color: '#1d1d1f' }}>
                        {formatTZS(p.amount)}
                      </td>
                      <td className="px-6 py-3.5 font-mono text-xs" style={{ color: '#aeaeb2' }}>
                        {p.mongikeTxId ? p.mongikeTxId.slice(0, 12) + '…' : '—'}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={statusBadge[p.status] ?? 'badge-gray'}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 20 && (
              <div
                className="px-6 py-4 flex items-center justify-between"
                style={{ borderTop: '1px solid #f0f0f5' }}
              >
                <p className="text-xs" style={{ color: '#6e6e73' }}>{total} total payments</p>
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

