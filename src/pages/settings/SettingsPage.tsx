import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Settings, KeyRound, CreditCard, Eye, EyeOff, AlertTriangle } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  // Payment settings
  const [mongikApiKey, setMongikApiKey] = useState('');
  const [mongikWebhookToken, setMongikWebhookToken] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [webhookTokenSet, setWebhookTokenSet] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const isMerchant = user?.role === 'MERCHANT';

  useEffect(() => {
    if (!isMerchant) return;
    api.get('/auth/settings').then((r: { data: { data: { mongikApiKeySet: boolean; mongikWebhookTokenSet: boolean } } }) => {
      setApiKeySet(r.data.data.mongikApiKeySet);
      setWebhookTokenSet(r.data.data.mongikWebhookTokenSet);
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
    if (!mongikApiKey && !mongikWebhookToken) {
      toast.error('Enter at least one value to save');
      return;
    }
    setSavingPayment(true);
    try {
      await api.patch('/auth/settings', {
        ...(mongikApiKey ? { mongikApiKey: mongikApiKey.trim() } : {}),
        ...(mongikWebhookToken ? { mongikWebhookToken: mongikWebhookToken.trim() } : {}),
      });
      toast.success('Payment settings saved');
      setMongikApiKey('');
      setMongikWebhookToken('');
      if (mongikApiKey) setApiKeySet(true);
      if (mongikWebhookToken) setWebhookTokenSet(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save payment settings');
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-0.5">Manage your account</p>
      </div>

      {/* Profile */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <Settings className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Account Info</h2>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex gap-4">
            <dt className="w-24 text-gray-500 font-medium">Name</dt>
            <dd className="text-gray-900">{user?.name}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-24 text-gray-500 font-medium">Email</dt>
            <dd className="text-gray-900">{user?.email}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-24 text-gray-500 font-medium">Role</dt>
            <dd className="text-gray-900 capitalize">{user?.role.toLowerCase().replace('_', ' ')}</dd>
          </div>
          {user?.tenant && (
            <div className="flex gap-4">
              <dt className="w-24 text-gray-500 font-medium">Shop</dt>
              <dd className="text-gray-900">{user.tenant.name}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Payment Settings — Merchants only */}
      {isMerchant && (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Payment Settings (Mongike)</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Configure your Mongike API key so WiFi payments are deposited directly into your account.
          </p>

          {!apiKeySet && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>Payments are not configured.</strong> Until you add your Mongike API key, customers cannot pay for WiFi on your hotspot.
              </span>
            </div>
          )}

          {apiKeySet && (
            <div className="flex items-center gap-2 mb-5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              Mongike API key is configured. Payments go to your account.
            </div>
          )}

          <form onSubmit={handlePaymentSettings} className="space-y-4">
            <div>
              <label className="label">
                Mongike API Key {apiKeySet && <span className="text-green-600 text-xs ml-1">(already set — enter new value to update)</span>}
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Found in your Mongike dashboard under API Keys.</p>
            </div>

            <div>
              <label className="label">
                Mongike Webhook Token {webhookTokenSet && <span className="text-green-600 text-xs ml-1">(already set)</span>}
              </label>
              <div className="relative">
                <input
                  type={showWebhookToken ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder={webhookTokenSet ? 'Enter new token to replace' : 'Webhook verification token'}
                  value={mongikWebhookToken}
                  onChange={(e) => setMongikWebhookToken(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showWebhookToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Set this same token in Mongike's webhook configuration.</p>
            </div>

            <button type="submit" className="btn-primary" disabled={savingPayment}>
              {savingPayment ? 'Saving...' : 'Save Payment Settings'}
            </button>
          </form>
        </div>
      )}

      {/* Change Password */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <KeyRound className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Change Password</h2>
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
            {saving ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
