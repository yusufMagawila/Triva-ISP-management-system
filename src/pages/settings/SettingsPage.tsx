import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Settings, KeyRound, CreditCard, Eye, EyeOff, AlertTriangle, CheckCircle, Zap } from 'lucide-react';

type Provider = 'MONGIKE' | 'ANYPAY' | 'ZENOPAY_MOBILE';

interface PaymentSettingsData {
  paymentProvider: Provider;
  mongikApiKey: string | null;
  anypayApiKey: string | null;
  anypayAccessToken: string | null;
  zenopayApiKey: string | null;
  mongikReady: boolean;
  anypayReady: boolean;
  zenopayReady: boolean;
}

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<PaymentSettingsData | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider>('MONGIKE');
  const [mongikKey, setMongikKey] = useState('');
  const [anypayKey, setAnypayKey] = useState('');
  const [anypayAccessToken, setAnypayAccessToken] = useState('');
  const [zenopayKey, setZenopayKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [testing, setTesting] = useState(false);

  const isMerchant = user?.role === 'MERCHANT';

  useEffect(() => {
    if (!isMerchant) return;
    api.get<{ data: PaymentSettingsData }>('/payment-settings')
      .then((r) => {
        setSettings(r.data.data);
        setSelectedProvider(r.data.data.paymentProvider);
      })
      .catch(() => {});
  }, [isMerchant]);

  const isReady = settings
    ? (selectedProvider === 'MONGIKE' ? settings.mongikReady : selectedProvider === 'ANYPAY' ? settings.anypayReady : settings.zenopayReady)
    : false;

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (passwords.next !== passwords.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.next });
      toast.success('Password changed successfully');
      setPasswords({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePaymentSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingPayment(true);
    try {
      const payload: Record<string, string | undefined> = { paymentProvider: selectedProvider };
      if (mongikKey) payload.mongikApiKey = mongikKey.trim();
      if (anypayKey) payload.anypayApiKey = anypayKey.trim();
      if (anypayAccessToken) payload.anypayAccessToken = anypayAccessToken.trim();
      if (zenopayKey) payload.zenopayApiKey = zenopayKey.trim();
      await api.put('/payment-settings', payload);
      toast.success('Payment settings saved');

      const r = await api.get<{ data: PaymentSettingsData }>('/payment-settings');
      setSettings(r.data.data);
      setMongikKey(''); setAnypayKey(''); setAnypayAccessToken(''); setZenopayKey('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleTestGateway() {
    setTesting(true);
    try {
      const r = await api.post<{ success: boolean; message: string }>('/payment-settings/test', {});
      toast.success(r.data.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="p-7 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}>
          Settings
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Manage your account</p>
      </div>

      {/* Account Info */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <Settings className="w-4 h-4" style={{ color: '#aeaeb2' }} />
          <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Account Info</h2>
        </div>
        <dl className="space-y-3 text-sm">
          {[
            { label: 'Name', value: user?.name },
            { label: 'Email', value: user?.email },
            { label: 'Role', value: user?.role.toLowerCase().replace('_', ' ') },
            ...(user?.tenant ? [{ label: 'Shop', value: user.tenant.name }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-4">
              <dt className="w-16 font-medium" style={{ color: '#aeaeb2' }}>{label}</dt>
              <dd className="capitalize" style={{ color: '#1d1d1f' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Payment Gateway */}
      {isMerchant && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4" style={{ color: '#aeaeb2' }} />
              <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Payment Gateway</h2>
            </div>
            {isReady && (
              <button
                type="button"
                onClick={handleTestGateway}
                disabled={testing}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: '#f4f4f5', color: '#1d1d1f' }}
              >
                <Zap className="w-3.5 h-3.5" />
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            )}
          </div>
          <p className="text-sm mb-5" style={{ color: '#6e6e73' }}>
            Choose which payment gateway collects WiFi payments into your account.
          </p>

          {/* Status badge */}
          {!isReady ? (
            <div className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Payments not configured.</strong> Customers cannot pay until you add your gateway credentials.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-5 text-sm rounded-xl p-3.5"
              style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>
                <strong>
                  {settings?.paymentProvider === 'ANYPAY' ? 'AnyPay Tanzania' : settings?.paymentProvider === 'ZENOPAY_MOBILE' ? 'ZenoPayMobile' : 'Mongike'}
                </strong> is active — payments go directly to your account.
              </span>
            </div>
          )}

          <form onSubmit={handleSavePaymentSettings} className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className="label mb-2">Active Gateway</label>
              <div className="grid grid-cols-3 gap-3">
                {(['MONGIKE', 'ANYPAY', 'ZENOPAY_MOBILE'] as Provider[]).map((p) => {
                  const active = selectedProvider === p;
                  const ready = settings ? (p === 'MONGIKE' ? settings.mongikReady : p === 'ANYPAY' ? settings.anypayReady : settings.zenopayReady) : false;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSelectedProvider(p)}
                      className="flex flex-col items-start gap-1 rounded-xl px-4 py-3 text-sm transition-all border"
                      style={{
                        borderColor: active ? '#007aff' : '#e5e5ea',
                        background: active ? '#eff6ff' : '#fafafa',
                        color: '#1d1d1f',
                      }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-semibold">
                          {p === 'MONGIKE' ? 'Mongike' : p === 'ANYPAY' ? 'AnyPay Tanzania' : 'ZenoPayMobile'}
                        </span>
                        {ready && <span className="w-2 h-2 rounded-full bg-green-500" />}
                      </div>
                      <span className="text-xs" style={{ color: '#6e6e73' }}>
                        {p === 'MONGIKE' ? 'mongike.com' : p === 'ANYPAY' ? 'anypaytanzania.com' : 'zenopaymobile.com'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mongike fields */}
            {selectedProvider === 'MONGIKE' && (
              <div>
                <label className="label">
                  Mongike API Key{' '}
                  {settings?.mongikReady && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showKeys ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder={settings?.mongikReady ? settings.mongikApiKey ?? 'mk_…' : 'mk_…'}
                    value={mongikKey}
                    onChange={(e) => setMongikKey(e.target.value)}
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => setShowKeys((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#aeaeb2' }}>
                    {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Found in your Mongike dashboard → API Keys.</p>
              </div>
            )}

            {/* AnyPay fields */}
            {selectedProvider === 'ANYPAY' && (
              <div className="space-y-4">
                <div>
                  <label className="label">
                    Access Token{' '}
                    {settings?.anypayReady && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showKeys ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder={settings?.anypayAccessToken ?? 'Your AnyPay access token'}
                      value={anypayAccessToken}
                      onChange={(e) => setAnypayAccessToken(e.target.value)}
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => setShowKeys((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#aeaeb2' }}>
                      {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Bearer token used in the Authorization header.</p>
                </div>

                <div>
                  <label className="label">
                    API Key{' '}
                    {settings?.anypayReady && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showKeys ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder={settings?.anypayApiKey ?? 'Your AnyPay API key'}
                      value={anypayKey}
                      onChange={(e) => setAnypayKey(e.target.value)}
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => setShowKeys((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#aeaeb2' }}>
                      {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Required. From anypaytanzania.com → API Keys (API-Key header).</p>
                </div>
              </div>
            )}

            {/* ZenoPayMobile fields */}
            {selectedProvider === 'ZENOPAY_MOBILE' && (
              <div>
                <label className="label">
                  ZenoPayMobile API Key{' '}
                  {settings?.zenopayReady && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showKeys ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder={settings?.zenopayReady ? settings.zenopayApiKey ?? 'zpay_…' : 'zpay_…'}
                    value={zenopayKey}
                    onChange={(e) => setZenopayKey(e.target.value)}
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => setShowKeys((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#aeaeb2' }}>
                    {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Found in your ZenoPayMobile dashboard → API Keys. Supports M-Pesa, Airtel Money, Tigo Pesa, and Halopesa.</p>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={savingPayment}>
              {savingPayment ? 'Saving…' : 'Save Gateway Settings'}
            </button>
          </form>
        </div>
      )}

      {/* Change Password */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <KeyRound className="w-4 h-4" style={{ color: '#aeaeb2' }} />
          <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Change Password</h2>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input type="password" className="input" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required />
          </div>
          <div>
            <label className="label">New Password</label>
            <input type="password" className="input" value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} required minLength={8} />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input type="password" className="input" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}


