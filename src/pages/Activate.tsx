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
      toast.success('Payment request sent! Check your phone.');
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
        // Re-fetch auth to get updated user/tenant
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Wifi className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">TRIVA</h1>
          <p className="text-gray-500 mt-1">Activate Your Account</p>
        </div>

        <div className="card p-8 shadow-xl">
          {!paid ? (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mb-3">
                  <CreditCard className="w-6 h-6 text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">One-Time Activation Fee</h2>
                <p className="text-gray-500 text-sm mt-1">Pay once to unlock your hotspot management account</p>
              </div>

              {/* Fee breakdown */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600 text-sm">Account Activation</span>
                  <span className="font-bold text-gray-900">TZS 35,000</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 border-t border-blue-100 pt-2 mt-2">
                  <span>Includes first month (BASIC plan)</span>
                  <span className="text-green-600 font-medium">+ 30 days free</span>
                </div>
              </div>

              <div className="space-y-3 text-sm text-gray-600 mb-6">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Full access to your TRIVA merchant dashboard</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Connect unlimited MikroTik routers</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Collect WiFi payments directly to your mobile money</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <span>After 30 days, renew from TZS 15,000/month</span>
                </div>
              </div>

              <form onSubmit={handlePay} className="space-y-4">
                <div>
                  <label className="label">M-Pesa / Airtel Money Number</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">+255</span>
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
                <button type="submit" className="btn-primary w-full text-base py-3" disabled={loading}>
                  {loading ? 'Sending payment request...' : 'Pay TZS 35,000 via Mobile Money'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
                <Clock className="w-8 h-8 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Awaiting Payment</h2>
              <p className="text-gray-500 text-sm mb-6">
                A payment prompt has been sent to <strong>{phone}</strong>. Enter your PIN to complete the payment.
                Once confirmed, click the button below.
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-6">
                <strong>Note:</strong> It may take up to 30 seconds after paying for the confirmation to come through.
              </div>

              <button
                onClick={handleCheckStatus}
                className="btn-primary w-full text-base py-3"
                disabled={checking}
              >
                {checking ? 'Checking...' : "I've Paid — Activate My Account"}
              </button>

              <button
                onClick={() => setPaid(false)}
                className="mt-3 text-sm text-gray-500 underline block w-full"
              >
                Use a different number
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-400 mt-4">
          Logged in as <strong>{user?.email}</strong> &nbsp;·&nbsp;
          <button onClick={() => { localStorage.clear(); window.location.href = '/login'; }} className="underline">
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
