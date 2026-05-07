import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Settings, KeyRound, CreditCard, Eye, EyeOff, AlertTriangle } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  const [mongikApiKey, setMongikApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const isMerchant = user?.role === 'MERCHANT';

  useEffect(() => {
    if (!isMerchant) return;
    api.get('/auth/settings').then((r: { data: { data: { mongikApiKeySet: boolean } } }) => {
      setApiKeySet(r.data.data.mongikApiKeySet);
    }).catch(() => {});
  }, [isMerchant]);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (passwords.next !== passwords.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      toast.success('Password changed successfully');
      setPasswords({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  async function handlePaymentSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!mongikApiKey) {
      toast.error('Enter a Mongike API key');
      return;
    }
    setSavingPayment(true);
    try {
      await api.patch('/auth/settings', {
        ...(mongikApiKey ? { mongikApiKey: mongikApiKey.trim() } : {}),
      });
      toast.success('Payment settings saved');
      setMongikApiKey('');
      if (mongikApiKey) setApiKeySet(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save payment settings');
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <div className="p-7 space-y-6 max-w-2xl">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
        >
          Settings
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#6e6e73' }}>Manage your account</p>
      </div>

      {/* Profile */}
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

      {/* Payment Settings */}
      {isMerchant && (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-4 h-4" style={{ color: '#aeaeb2' }} />
            <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Payment Settings (Mongike)</h2>
          </div>
          <p className="text-sm mb-4" style={{ color: '#6e6e73' }}>
            Configure your Mongike API key so WiFi payments are deposited directly into your account.
          </p>

          {!apiKeySet && (
            <div
              className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>Payments are not configured.</strong> Customers cannot pay until you add your Mongike API key.
              </span>
            </div>
          )}

          {apiKeySet && (
            <div
              className="flex items-center gap-2 mb-5 text-sm rounded-xl p-3.5"
              style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}
            >
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              Mongike API key is configured. Payments go to your account.
            </div>
          )}

          <form onSubmit={handlePaymentSettings} className="space-y-4">
            <div>
              <label className="label">
                Mongike API Key{' '}
                {apiKeySet && (
                  <span className="text-xs ml-1" style={{ color: '#34c759' }}>
                    (already set — enter new value to update)
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder={apiKeySet ? 'Enter new key to replace' : 'mk_...'}
                  value={mongikApiKey}
                  onChange={(e) => setMongikApiKey(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#aeaeb2' }}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>
                Found in your Mongike dashboard under API Keys.
              </p>
            </div>
            <button type="submit" className="btn-primary" disabled={savingPayment}>
              {savingPayment ? 'Saving…' : 'Save Payment Settings'}
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


