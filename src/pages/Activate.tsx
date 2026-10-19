import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { Wifi, CreditCard, CheckCircle2, Clock } from 'lucide-react';

export default function ActivatePage() {
  const { user, setAuth } = useAuthStore();
  const navigate = useNavigate();
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/activate-payment', { phone: phone.trim() });
      setPaid(true);
      toast.success('Payment request sent. Check your phone to continue.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment initiation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckStatus() {
    setChecking(true);
    try {
      const res = await api.get('/auth/me') as { data: { data: { tenantStatus?: string; tenant?: { status: string } } } };
      const tenantStatus = res.data.data?.tenant?.status ?? res.data.data?.tenantStatus;
      if (tenantStatus === 'ACTIVE') {
        toast.success('Account activated! Welcome to TRIVA.');
        const meRes = await api.get('/auth/me') as { data: { data: unknown } };
        const token = localStorage.getItem('token') ?? '';
        setAuth(token, meRes.data.data as Parameters<typeof setAuth>[1]);
        navigate('/dashboard');
      } else {
        toast('Payment not confirmed yet. Try again in a moment.', { icon: '⏳' });
      }
    } catch {
      toast.error('Could not check status. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ background: 'var(--primary)' }}
          >
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: 'var(--text)', letterSpacing: '-0.03em' }}
          >
            TRIVA
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Activate Your Account
          </p>
        </div>

        <div className="card p-8">
          {!paid ? (
            <>
              <div className="text-center mb-6">
                <div
                  className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-3"
                  style={{ background: '#fff3e0' }}
                >
                  <CreditCard className="w-5 h-5" style={{ color: '#f57c00' }} />
                </div>
                <h2
                  className="text-xl font-semibold tracking-tight"
                  style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}
                >
                  One-Time Activation Fee
                </h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                  Pay once to unlock your hotspot management account
                </p>
              </div>

              {/* Fee breakdown */}
              <div
                className="rounded-2xl p-4 mb-5"
                style={{ background: 'var(--primary-soft)', border: '1px solid color-mix(in srgb, var(--primary) 22%, transparent)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm" style={{ color: 'var(--text)' }}>Account Activation</span>
                  <span className="font-bold" style={{ color: 'var(--text)' }}>TZS 35,000</span>
                </div>
                <div
                  className="flex items-center justify-between text-xs pt-2 mt-2"
                  style={{ borderTop: '1px solid color-mix(in srgb, var(--primary) 22%, transparent)', color: 'var(--text-2)' }}
                >
                  <span>Includes first month (BASIC plan)</span>
                  <span className="font-medium" style={{ color: 'var(--success)' }}>+ 30 days free</span>
                </div>
              </div>

              <div className="space-y-2.5 text-sm mb-5" style={{ color: 'var(--text)' }}>
                {[
                  'Full access to your TRIVA merchant dashboard',
                  'Connect MikroTik routers with zero-touch provisioning',
                  'Collect WiFi payments directly to your mobile money',
                  'After 30 days, renew from TZS 15,000/month',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <form onSubmit={handlePay} className="space-y-4">
                <div>
                  <label className="label">M-Pesa / Airtel Money Number</label>
                  <div className="relative">
                    <span
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium"
                      style={{ color: 'var(--text-2)' }}
                    >
                      +255
                    </span>
                    <input
                      type="tel"
                      className="input pl-14"
                      placeholder="7XX XXX XXX"
                      value={phone.replace(/^\+?255/, '')}
                      onChange={(e) => setPhone('+255' + e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn-primary w-full py-3 text-base" disabled={loading}>
                  {loading ? 'Sending payment request…' : 'Pay TZS 35,000 via Mobile Money'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div
                className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{ background: '#fff8e1' }}
              >
                <Clock className="w-7 h-7" style={{ color: '#f59e0b' }} />
              </div>
              <h2
                className="text-xl font-semibold mb-2 tracking-tight"
                style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}
              >
                Awaiting Payment
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
                A payment prompt was sent to <strong style={{ color: 'var(--text)' }}>{phone}</strong>. Enter your PIN to complete, then tap the button below.
              </p>

              <div
                className="rounded-xl p-3.5 text-sm mb-5"
                style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)', color: 'color-mix(in srgb, var(--warning) 62%, var(--text))' }}
              >
                It may take up to 30 seconds after paying for confirmation.
              </div>

              <button
                onClick={handleCheckStatus}
                className="btn-primary w-full py-3 text-base"
                disabled={checking}
              >
                {checking ? 'Checking…' : "I've Paid — Activate My Account"}
              </button>

              <button
                onClick={() => setPaid(false)}
                className="mt-3 text-sm hover:underline block w-full"
                style={{ color: 'var(--text-2)' }}
              >
                Use a different number
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-sm mt-5" style={{ color: 'var(--text-3)' }}>
          Logged in as <strong style={{ color: 'var(--text-2)' }}>{user?.email}</strong>{' '}·{' '}
          <button
            onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
            className="underline"
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}


