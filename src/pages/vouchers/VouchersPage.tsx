import { useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Ticket, Plus, X, Copy, Check, Ban, Clock, Zap } from 'lucide-react';
import { formatTZS } from '../../utils/currency';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  name: string;
  durationMins: number;
  price: number;
}

interface Voucher {
  id: string;
  code: string;
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
  redeemedMac: string | null;
  plan: Plan;
}

interface Stats {
  ACTIVE: number;
  REDEEMED: number;
  EXPIRED: number;
  CANCELLED: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `${Math.floor(mins / 1440)} day${Math.floor(mins / 1440) > 1 ? 's' : ''}`;
}

const statusBadge: Record<Voucher['status'], string> = {
  ACTIVE: 'badge-green',
  REDEEMED: 'badge-blue',
  EXPIRED: 'badge-yellow',
  CANCELLED: 'badge-gray',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [stats, setStats] = useState<Stats>({ ACTIVE: 0, REDEEMED: 0, EXPIRED: 0, CANCELLED: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ planId: '', quantity: '10', expiresAt: '' });
  const [creating, setCreating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    loadVouchers();
  }, [page, statusFilter]);

  async function loadVouchers() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<{ data: Voucher[]; stats: Stats; pagination: { total: number } }>(
        `/vouchers?${params}`
      );
      setVouchers(res.data.data);
      setStats(res.data.stats);
      setTotal(res.data.pagination.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vouchers');
    } finally {
      setLoading(false);
    }
  }

  async function openCreate() {
    try {
      const res = await api.get<{ data: Plan[] }>('/plans');
      setPlans(res.data.data);
      setForm({ planId: res.data.data[0]?.id ?? '', quantity: '10', expiresAt: '' });
      setNewCodes([]);
      setShowCreate(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load plans');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseInt(form.quantity, 10);
    if (!form.planId || isNaN(qty) || qty < 1 || qty > 100) {
      toast.error('Select a plan and enter quantity between 1 and 100');
      return;
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = { planId: form.planId, quantity: qty };
      if (form.expiresAt) body.expiresAt = new Date(form.expiresAt).toISOString();

      const res = await api.post<{ data: Voucher[] }>('/vouchers', body);
      const codes = res.data.data.map((v) => v.code);
      setNewCodes(codes);
      toast.success(`${codes.length} voucher${codes.length !== 1 ? 's' : ''} created`);
      loadVouchers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create vouchers');
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this voucher? It can no longer be used.')) return;
    try {
      await api.delete(`/vouchers/${id}`);
      toast.success('Voucher cancelled');
      loadVouchers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel voucher');
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    });
  }

  function copyAllCodes() {
    navigator.clipboard.writeText(newCodes.join('\n')).then(() => {
      toast.success('All codes copied to clipboard');
    });
  }

  const LIMIT = 50;

  return (
    <div className="p-7 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#1d1d1f', letterSpacing: '-0.02em' }}>
            Vouchers
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#6e6e73' }}>
            Create pre-paid voucher codes that customers redeem for WiFi access
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4" />
          Create Vouchers
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            { label: 'Active', key: 'ACTIVE', color: '#34c759' },
            { label: 'Redeemed', key: 'REDEEMED', color: '#0071e3' },
            { label: 'Expired', key: 'EXPIRED', color: '#f5a623' },
            { label: 'Cancelled', key: 'CANCELLED', color: '#8e8e93' },
          ] as const
        ).map(({ label, key, color }) => (
          <button
            key={key}
            onClick={() => { setStatusFilter(statusFilter === key ? '' : key); setPage(1); }}
            className="card p-4 text-left transition-all"
            style={statusFilter === key ? { outline: `2px solid ${color}`, outlineOffset: '2px' } : {}}
          >
            <p className="text-sm font-medium" style={{ color: '#6e6e73' }}>{label}</p>
            <p className="text-2xl font-semibold mt-1" style={{ color }}>
              {stats[key]}
            </p>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {statusFilter && (
          <div className="px-4 pt-3 flex items-center gap-2">
            <span className="text-xs" style={{ color: '#6e6e73' }}>
              Filtering: {statusFilter}
            </span>
            <button
              className="text-xs underline"
              style={{ color: '#0071e3' }}
              onClick={() => { setStatusFilter(''); setPage(1); }}
            >
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : vouchers.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3" style={{ color: '#6e6e73' }}>
            <Ticket className="w-10 h-10 opacity-30" />
            <p className="text-sm">No vouchers yet. Create your first batch.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #f0f0f5' }}>
                    {['Code', 'Plan', 'Status', 'Created', 'Expires', 'Redeemed At', ''].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wide"
                        style={{ color: '#6e6e73' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr key={v.id} style={{ borderBottom: '1px solid #f8f8fa' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#1d1d1f' }}>
                            {v.code}
                          </span>
                          <button
                            onClick={() => copyCode(v.code)}
                            className="opacity-40 hover:opacity-100 transition-opacity"
                          >
                            {copiedCode === v.code ? (
                              <Check className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" style={{ color: '#6e6e73' }} />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p style={{ color: '#1d1d1f' }}>{v.plan.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: '#6e6e73' }}>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(v.plan.durationMins)}
                          </span>
                          &nbsp;·&nbsp;{formatTZS(v.plan.price)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusBadge[v.status]}>{v.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#6e6e73' }}>
                        {format(new Date(v.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#6e6e73' }}>
                        {v.expiresAt ? format(new Date(v.expiresAt), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#6e6e73' }}>
                        {v.redeemedAt ? (
                          <div>
                            <p>{format(new Date(v.redeemedAt), 'MMM d, HH:mm')}</p>
                            {v.redeemedMac && (
                              <p className="font-mono text-xs opacity-60">{v.redeemedMac}</p>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {v.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleCancel(v.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            title="Cancel voucher"
                          >
                            <Ban className="w-3.5 h-3.5" style={{ color: '#ff3b30' }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div
                className="flex items-center justify-between px-4 py-3 text-sm"
                style={{ borderTop: '1px solid #f0f0f5' }}
              >
                <span style={{ color: '#6e6e73' }}>
                  {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={page * LIMIT >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between p-5 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: '#1d1d1f' }}>Create Vouchers</h2>
              <button onClick={() => { setShowCreate(false); setNewCodes([]); }}>
                <X className="w-5 h-5" style={{ color: '#6e6e73' }} />
              </button>
            </div>

            {newCodes.length === 0 ? (
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                {/* Plan */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1d1d1f' }}>
                    WiFi Plan
                  </label>
                  {plans.length === 0 ? (
                    <p className="text-sm" style={{ color: '#ff3b30' }}>
                      No active plans found. Create a plan first.
                    </p>
                  ) : (
                    <select
                      className="input w-full"
                      value={form.planId}
                      onChange={(e) => setForm({ ...form, planId: e.target.value })}
                      required
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {formatDuration(p.durationMins)} · {formatTZS(p.price)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1d1d1f' }}>
                    Quantity <span style={{ color: '#6e6e73', fontWeight: 400 }}>(1–100)</span>
                  </label>
                  <input
                    type="number"
                    className="input w-full"
                    min={1}
                    max={100}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    required
                  />
                </div>

                {/* Expiry (optional) */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1d1d1f' }}>
                    Expiry Date <span style={{ color: '#6e6e73', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="date"
                    className="input w-full"
                    value={form.expiresAt}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  />
                  <p className="text-xs mt-1" style={{ color: '#6e6e73' }}>
                    Leave empty for vouchers that never expire
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex-1"
                    disabled={creating || plans.length === 0}
                  >
                    {creating ? 'Creating…' : `Create ${form.quantity || 0} Voucher${parseInt(form.quantity) !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </form>
            ) : (
              /* Generated codes view */
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: '#f0f9f0' }}>
                  <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <p className="text-sm font-medium text-green-700">
                    {newCodes.length} voucher{newCodes.length !== 1 ? 's' : ''} created successfully
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium" style={{ color: '#1d1d1f' }}>Generated Codes</p>
                    <button
                      className="text-xs flex items-center gap-1"
                      style={{ color: '#0071e3' }}
                      onClick={copyAllCodes}
                    >
                      <Copy className="w-3 h-3" />
                      Copy all
                    </button>
                  </div>
                  <div
                    className="rounded-xl p-3 space-y-1.5 overflow-y-auto"
                    style={{ background: '#f5f5f7', maxHeight: '280px' }}
                  >
                    {newCodes.map((code) => (
                      <div key={code} className="flex items-center justify-between">
                        <span
                          className="font-mono text-sm font-semibold tracking-widest"
                          style={{ color: '#1d1d1f' }}
                        >
                          {code}
                        </span>
                        <button onClick={() => copyCode(code)} className="ml-2 opacity-50 hover:opacity-100">
                          {copiedCode === code ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" style={{ color: '#6e6e73' }} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs mt-2" style={{ color: '#6e6e73' }}>
                    Save these codes — give one to each customer in exchange for payment.
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    className="btn-secondary flex-1"
                    onClick={() => { setNewCodes([]); setShowCreate(false); }}
                  >
                    Done
                  </button>
                  <button
                    className="btn-primary flex-1"
                    onClick={() => { setNewCodes([]); setForm({ ...form, quantity: '10' }); }}
                  >
                    Create More
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
