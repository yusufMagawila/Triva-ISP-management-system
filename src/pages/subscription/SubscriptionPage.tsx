import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { formatTZS } from '../../utils/currency';
import toast from 'react-hot-toast';
import { Shield, CheckCircle2, AlertTriangle, CreditCard, Phone } from 'lucide-react';
import { format } from 'date-fns';

interface SubscriptionData {
  id: string;
  plan: 'BASIC' | 'STANDARD' | 'PREMIUM';
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startsAt: string;
  expiresAt: string;
  daysLeft: number;
  planPrices: { BASIC: number; STANDARD: number; PREMIUM: number };
  planLimits: {
    BASIC: { maxRouters: number; maxSessionsPerDay: number };
    STANDARD: { maxRouters: number; maxSessionsPerDay: number };
    PREMIUM: { maxRouters: number; maxSessionsPerDay: number };
  };
}

const PLAN_DETAILS = {
  BASIC: {
    label: 'Basic',
    features: [
      'Up to 2 routers',
      'Up to 200 WiFi sessions/day',
      'Captive portal payments',
      'Dashboard & reports',
    ],
    accent: '#0071e3',
    recommended: false as const,
  },
  STANDARD: {
    label: 'Standard',
    features: [
      'Up to 10 routers',
      'Unlimited WiFi sessions',
      'Captive portal payments',
      'Dashboard & reports',
    ],
    accent: '#34c759',
    recommended: true as const,
  },
  PREMIUM: {
    label: 'Premium',
    features: [
      'Unlimited routers',
      'Unlimited WiFi sessions',
      'Captive portal payments',
      'Dashboard & reports',
    ],
    accent: '#af52de',
    recommended: false as const,
  },
};

export default function SubscriptionPage() {
  const { user } = useAuthStore();
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<'BASIC' | 'STANDARD' | 'PREMIUM'>('BASIC');
  const [months, setMonths] = useState(1);
  const [phone, setPhone] = useState('');
  const [paying, setPaying] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);

  useEffect(() => {
    api
      .get<{ data: SubscriptionData }>('/subscription')
      .then((r) => {
        setSub(r.data.data);
        setSelectedPlan(r.data.data.plan);
        if (r.data.data.status === 'EXPIRED') {
          setShowPayForm(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const totalAmount = sub ? sub.planPrices[selectedPlan] * months : 0;

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    setPaying(true);
    try {
      await api.post('/subscription/pay', { plan: selectedPlan, months, phone });
      toast.success('Payment prompt sent! Check your phone and enter PIN to complete.');
      setShowPayForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to initiate payment');
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const isActive = sub?.status === 'ACTIVE';
  const isExpiringSoon = sub && sub.daysLeft <= 7;

  return (
    <div className="p-7 space-y-6 max-w-3xl">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
        >
          Subscription
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Manage your TRIVA plan</p>
      </div>

      {/* Current status */}
      {sub && (
        <div
          className="card p-6"
          style={{
            border: `1.5px solid ${isActive ? '#bbf7d0' : '#fecaca'}`,
            background: isActive ? '#f0fdf4' : '#fff5f5',
          }}
        >
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              {isActive ? (
                <CheckCircle2 className="w-9 h-9" style={{ color: '#34c759' }} />
              ) : (
                <AlertTriangle className="w-9 h-9" style={{ color: '#ef4444' }} />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-base font-bold" style={{ color: '#1d1d1f' }}>
                  {PLAN_DETAILS[sub.plan].label} Plan
                </h2>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: isActive ? '#dcfce7' : '#fee2e2',
                    color: isActive ? '#166534' : '#991b1b',
                  }}
                >
                  {sub.status}
                </span>
              </div>
              <p className="text-sm" style={{ color: isActive ? '#166534' : '#991b1b' }}>
                {isActive
                  ? `Active until ${format(new Date(sub.expiresAt), 'MMMM d, yyyy')} · ${sub.daysLeft} days left`
                  : `Expired on ${format(new Date(sub.expiresAt), 'MMMM d, yyyy')}`}
              </p>
            </div>
            <button className="btn-primary flex-shrink-0" onClick={() => setShowPayForm(true)}>
              <CreditCard className="w-4 h-4" />
              {sub.status === 'EXPIRED' ? 'Reactivate' : 'Renew / Upgrade'}
            </button>
          </div>

          {isExpiringSoon && isActive && (
            <div
              className="mt-4 pt-4 flex items-center gap-2 text-sm"
              style={{ borderTop: '1px solid rgba(0,0,0,0.08)', color: '#166534' }}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Your subscription expires soon. Renew now to avoid service interruption.
            </div>
          )}
        </div>
      )}

      {/* Plan selection + payment form */}
      {showPayForm && sub && (
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold" style={{ color: '#1d1d1f' }}>Choose a Plan</h2>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(Object.keys(PLAN_DETAILS) as Array<keyof typeof PLAN_DETAILS>).map((plan) => {
              const detail = PLAN_DETAILS[plan];
              const isSelected = selectedPlan === plan;
              return (
                <button
                  key={plan}
                  onClick={() => setSelectedPlan(plan)}
                  className="text-left rounded-2xl p-4 transition-all"
                  style={{
                    border: isSelected ? `2px solid ${detail.accent}` : '2px solid #f0f0f5',
                    background: isSelected ? detail.accent + '0d' : 'white',
                  }}
                >
                  {detail.recommended && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full mb-2 inline-block text-white"
                      style={{ background: detail.accent }}
                    >
                      Recommended
                    </span>
                  )}
                  <p className="font-bold mb-0.5" style={{ color: '#1d1d1f' }}>{detail.label}</p>
                  <p className="text-xl font-bold mb-3" style={{ color: detail.accent }}>
                    {formatTZS(sub.planPrices[plan])}
                    <span className="text-sm font-normal" style={{ color: '#6e6e73' }}>/mo</span>
                  </p>
                  <ul className="space-y-1">
                    {detail.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-xs" style={{ color: '#3a3a3c' }}>
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#34c759' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          {/* Duration + phone */}
          <form
            onSubmit={handlePay}
            className="space-y-4 pt-4"
            style={{ borderTop: '1px solid #f0f0f5' }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Duration</label>
                <select
                  className="input"
                  value={months}
                  onChange={(e) => setMonths(parseInt(e.target.value))}
                >
                  {[1, 3, 6, 12].map((m) => (
                    <option key={m} value={m}>
                      {m} month{m > 1 ? 's' : ''} — {formatTZS(sub.planPrices[selectedPlan] * m)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">M-Pesa / Tigo / Airtel Number</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#aeaeb2' }} />
                  <input
                    type="tel"
                    className="input pl-9"
                    placeholder="+255 7XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            <div
              className="rounded-2xl p-4 flex items-center justify-between"
              style={{ background: '#f5f5f7' }}
            >
              <div>
                <p className="text-xs mb-0.5" style={{ color: '#6e6e73' }}>Total to pay</p>
                <p
                  className="text-2xl font-bold tracking-tight"
                  style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
                >
                  {formatTZS(totalAmount)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#aeaeb2' }}>
                  {PLAN_DETAILS[selectedPlan].label} · {months} month{months > 1 ? 's' : ''}
                </p>
              </div>
              <Shield className="w-9 h-9" style={{ color: '#d2d2d7' }} />
            </div>

            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={paying}>
                {paying ? 'Sending prompt…' : `Pay ${formatTZS(totalAmount)}`}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowPayForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* What's included */}
      {sub && !showPayForm && (
        <div className="card p-6">
          <h2 className="font-semibold mb-4 text-sm" style={{ color: '#1d1d1f' }}>
            Your {PLAN_DETAILS[sub.plan].label} Plan Includes
          </h2>
          <ul className="space-y-2.5">
            {PLAN_DETAILS[sub.plan].features.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm" style={{ color: '#3a3a3c' }}>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#34c759' }} />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
