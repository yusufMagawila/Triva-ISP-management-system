import { useEffect, useState } from 'react';
import api from '../../services/api';
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

const statusColors: Record<string, string> = {
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 mt-0.5">Transaction history</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No payments yet</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">Date</th>
                    <th className="px-5 py-3 text-left">Phone</th>
                    <th className="px-5 py-3 text-left">Plan</th>
                    <th className="px-5 py-3 text-left">Amount</th>
                    <th className="px-5 py-3 text-left">Tx ID</th>
                    <th className="px-5 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-xs">{format(new Date(p.createdAt), 'MMM d, HH:mm')}</td>
                      <td className="px-5 py-3">{p.phone ?? '—'}</td>
                      <td className="px-5 py-3">{p.plan.name}</td>
                      <td className="px-5 py-3 font-semibold">
                        {p.currency} {Number(p.amount).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">
                        {p.mongikeTxId ? p.mongikeTxId.slice(0, 12) + '...' : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={statusColors[p.status] ?? 'badge-gray'}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 20 && (
              <div className="p-4 flex items-center justify-between border-t border-gray-100">
                <p className="text-sm text-gray-500">{total} total payments</p>
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
