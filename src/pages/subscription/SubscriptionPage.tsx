import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { formatTZS } from '../../utils/currency';
import toast from 'react-hot-toast';
import { Shield, CheckCircle2, AlertTriangle, CreditCard, Phone } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

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
    color: 'border-blue-200 bg-blue-50',
    badge: 'bg-blue-100 text-blue-700',
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
    color: 'border-brand-300 bg-brand-50',
    badge: 'bg-brand-100 text-brand-700',
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
    color: 'border-purple-200 bg-purple-50',
    badge: 'bg-purple-100 text-purple-700',
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
        <div className="animate-spin w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const statusColor =
    sub?.status === 'ACTIVE'
      ? 'bg-green-50 border-green-200 text-green-800'
      : 'bg-red-50 border-red-200 text-red-800';

  const isExpiringSoon = sub && sub.daysLeft <= 7;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription</h1>
        <p className="text-gray-500 mt-0.5">Manage your TRIVA plan</p>
      </div>

      {/* Current status */}
      {sub && (
        <div className={`card p-6 border-2 ${statusColor}`}>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              {sub.status === 'ACTIVE' ? (
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              ) : (
                <AlertTriangle className="w-10 h-10 text-red-500" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold">{PLAN_DETAILS[sub.plan].label} Plan</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PLAN_DETAILS[sub.plan].badge}`}>
                  {sub.status}
                </span>
              </div>
              <p className="text-sm">
                {sub.status === 'ACTIVE'
                  ? `Active until ${format(new Date(sub.expiresAt), 'MMMM d, yyyy')} · ${sub.daysLeft} days left`
                  : `Expired on ${format(new Date(sub.expiresAt), 'MMMM d, yyyy')}`}
              </p>
            </div>
            <button
              className="btn-primary flex-shrink-0"
              onClick={() => setShowPayForm(true)}
            >
              <CreditCard className="w-4 h-4" />
              {sub.status === 'EXPIRED' ? 'Reactivate' : 'Renew / Upgrade'}
            </button>
          </div>

          {isExpiringSoon && sub.status !== 'EXPIRED' && (
            <div className="mt-4 pt-4 border-t border-current/20 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Your subscription expires soon. Renew now to avoid service interruption.
            </div>
          )}
        </div>
      )}

      {/* Plan selection + payment form */}
      {showPayForm && sub && (
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold text-gray-900 text-lg">Choose a Plan</h2>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.keys(PLAN_DETAILS) as Array<keyof typeof PLAN_DETAILS>).map((plan) => {
              const detail = PLAN_DETAILS[plan];
              const isSelected = selectedPlan === plan;
              return (
                <button
                  key={plan}
                  onClick={() => setSelectedPlan(plan)}
                  className={`text-left rounded-xl border-2 p-4 transition-all ${
                    isSelected ? detail.color + ' ring-2 ring-brand-400' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {detail.recommended && (
                    <span className="text-xs bg-brand-600 text-white px-2 py-0.5 rounded-full font-medium mb-2 inline-block">
                      Recommended
                    </span>
                  )}
                  <p className="font-bold text-gray-900 mb-0.5">{detail.label}</p>
                  <p className="text-xl font-bold text-brand-600 mb-3">
                    {formatTZS(sub.planPrices[plan])}<span className="text-sm font-normal text-gray-500">/mo</span>
                  </p>
                  <ul className="space-y-1">
                    {detail.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          {/* Duration + phone */}
          <form onSubmit={handlePay} className="space-y-4 pt-2 border-t border-gray-100">
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
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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

            <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total to pay</p>
                <p className="text-2xl font-bold text-gray-900">{formatTZS(totalAmount)}</p>
                <p className="text-xs text-gray-400">
                  {PLAN_DETAILS[selectedPlan].label} · {months} month{months > 1 ? 's' : ''}
                </p>
              </div>
              <Shield className="w-10 h-10 text-gray-300" />
            </div>

            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={paying}>
                {paying ? 'Sending prompt...' : `Pay ${formatTZS(totalAmount)}`}
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
          <h2 className="font-semibold text-gray-900 mb-4">Your {PLAN_DETAILS[sub.plan].label} Plan Includes</h2>
          <ul className="space-y-2">
            {PLAN_DETAILS[sub.plan].features.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
