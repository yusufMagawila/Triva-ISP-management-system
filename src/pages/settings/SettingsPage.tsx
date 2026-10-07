import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Settings, KeyRound, CreditCard, Eye, EyeOff, AlertTriangle, CheckCircle, Zap, Copy } from 'lucide-react';

interface PaymentSettingsData {
  provider: 'ANYPAY';
  enabled: boolean;
  configured: boolean;
  anypayApiKey: string | null;
  anypayAccessToken: string | null;
  anypayBaseUrl: string;
  webhookUrl: string | null;
}

interface PlatformPaymentData {
  enabled: boolean;
  configured: boolean;
  apiKeyMasked: string | null;
  accessTokenMasked: string | null;
  baseUrl: string;
}

interface PortalNoticeSettingsData {
  portalNoticeName: string | null;
  portalNoticeMessage: string | null;
  portalNoticeColor: string;
}

const DEFAULT_PORTAL_NOTICE_COLOR = '#2563eb';
const DEFAULT_ANYAPAY_BASE_URL = 'https://anypaytanzania.com/api/payments';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<PaymentSettingsData | null>(null);
  const [anypayKey, setAnypayKey] = useState('');
  const [anypayToken, setAnypayToken] = useState('');
  const [anypayBaseUrl, setAnypayBaseUrl] = useState('');
  const [anypayEnabled, setAnypayEnabled] = useState(true);
  const [showKeys, setShowKeys] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [testing, setTesting] = useState(false);

  const [platform, setPlatform] = useState<PlatformPaymentData | null>(null);
  const [platformKey, setPlatformKey] = useState('');
  const [platformToken, setPlatformToken] = useState('');
  const [platformBaseUrl, setPlatformBaseUrl] = useState('');
  const [platformEnabled, setPlatformEnabled] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [testingPlatform, setTestingPlatform] = useState(false);

  const [portalNoticeName, setPortalNoticeName] = useState('');
  const [portalNoticeMessage, setPortalNoticeMessage] = useState('');
  const [portalNoticeColor, setPortalNoticeColor] = useState(DEFAULT_PORTAL_NOTICE_COLOR);
  const [savingPortalNotice, setSavingPortalNotice] = useState(false);

  const isMerchant = user?.role === 'MERCHANT';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!isMerchant) return;
    api.get<{ data: PaymentSettingsData }>('/payment-settings')
      .then((r) => {
        setSettings(r.data.data);
        setAnypayEnabled(r.data.data.enabled);
        setAnypayBaseUrl(r.data.data.anypayBaseUrl);
      })
      .catch(() => {});
  }, [isMerchant]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get<{ data: PlatformPaymentData }>('/admin/payment-config')
      .then((r) => {
        setPlatform(r.data.data);
        setPlatformEnabled(r.data.data.enabled);
        setPlatformBaseUrl(r.data.data.baseUrl);
      })
      .catch(() => {});
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isMerchant) return;
    api.get<{ data: PortalNoticeSettingsData }>('/portal-settings')
      .then((r) => {
        const portalSettings = r.data.data;
        setPortalNoticeName(portalSettings.portalNoticeName ?? '');
        setPortalNoticeMessage(portalSettings.portalNoticeMessage ?? '');
        setPortalNoticeColor(portalSettings.portalNoticeColor ?? DEFAULT_PORTAL_NOTICE_COLOR);
      })
      .catch(() => {});
  }, [isMerchant]);

  const isReady = !!settings?.configured && settings.enabled;

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
      const payload: Record<string, unknown> = {
        anypayEnabled,
        anypayBaseUrl: anypayBaseUrl.trim() || '',
      };
      if (anypayKey) payload.anypayApiKey = anypayKey.trim();
      if (anypayToken) payload.anypayAccessToken = anypayToken.trim();
      await api.put('/payment-settings', payload);
      toast.success('Payment settings saved');

      const r = await api.get<{ data: PaymentSettingsData }>('/payment-settings');
      setSettings(r.data.data);
      setAnypayKey(''); setAnypayToken('');
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

  async function handleSavePlatform(e: React.FormEvent) {
    e.preventDefault();
    setSavingPlatform(true);
    try {
      const payload: Record<string, unknown> = {
        enabled: platformEnabled,
        baseUrl: platformBaseUrl.trim(),
      };
      if (platformKey) payload.apiKey = platformKey.trim();
      if (platformToken) payload.accessToken = platformToken.trim();
      const r = await api.put<{ data: PlatformPaymentData }>('/admin/payment-config', payload);
      setPlatform(r.data.data);
      setPlatformKey(''); setPlatformToken('');
      toast.success('Platform payment configuration saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingPlatform(false);
    }
  }

  async function handleTestPlatform() {
    setTestingPlatform(true);
    try {
      const r = await api.post<{ success: boolean; message: string }>('/admin/payment-config/test', {});
      toast.success(r.data.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTestingPlatform(false);
    }
  }

  async function handleSavePortalNotice(e: React.FormEvent) {
    e.preventDefault();
    setSavingPortalNotice(true);
    try {
      const payload = {
        portalNoticeName: portalNoticeName.trim(),
        portalNoticeMessage: portalNoticeMessage.trim(),
        portalNoticeColor,
      };

      const response = await api.put<{ message: string; data: PortalNoticeSettingsData }>('/portal-settings', payload);
      setPortalNoticeName(response.data.data.portalNoticeName ?? '');
      setPortalNoticeMessage(response.data.data.portalNoticeMessage ?? '');
      setPortalNoticeColor(response.data.data.portalNoticeColor ?? DEFAULT_PORTAL_NOTICE_COLOR);
      toast.success(response.data.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save portal notice');
    } finally {
      setSavingPortalNotice(false);
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
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

      {/* AnyPay — merchant gateway configuration */}
      {isMerchant && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4" style={{ color: '#aeaeb2' }} />
              <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Payments — AnyPay</h2>
            </div>
            {settings?.configured && (
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
            Customer WiFi payments are collected through AnyPay into your account. Credentials are stored encrypted.
          </p>

          {/* Status badge */}
          {!isReady ? (
            <div className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Payments not configured.</strong> Customers cannot pay until you add your AnyPay credentials.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-5 text-sm rounded-xl p-3.5"
              style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span><strong>AnyPay Tanzania</strong> is active — payments go directly to your account.</span>
            </div>
          )}

          <form onSubmit={handleSavePaymentSettings} className="space-y-5">
            <label className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: '#e5e5ea' }}>
              <div>
                <p className="text-sm font-medium" style={{ color: '#1d1d1f' }}>Accept payments</p>
                <p className="text-xs" style={{ color: '#6e6e73' }}>Disable to pause customer payments without removing credentials.</p>
              </div>
              <input
                type="checkbox"
                checked={anypayEnabled}
                onChange={(e) => setAnypayEnabled(e.target.checked)}
                className="h-5 w-5 accent-blue-600"
              />
            </label>

            <div>
              <label className="label">
                AnyPay API Key{' '}
                {settings?.configured && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
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

            <div>
              <label className="label">
                Access Token{' '}
                {settings?.anypayAccessToken && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                className="input"
                placeholder={settings?.anypayAccessToken ?? 'Optional — only if your account uses one'}
                value={anypayToken}
                onChange={(e) => setAnypayToken(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Optional bearer token for accounts that require it.</p>
            </div>

            <div>
              <label className="label">API Base URL</label>
              <input
                type="url"
                className="input"
                placeholder={DEFAULT_ANYAPAY_BASE_URL}
                value={anypayBaseUrl}
                onChange={(e) => setAnypayBaseUrl(e.target.value)}
              />
              <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>Leave empty to use the default AnyPay endpoint.</p>
            </div>

            {settings?.webhookUrl && (
              <div>
                <label className="label">Webhook URL</label>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: '#f5f5f7', border: '1px solid #e8e8ed' }}>
                  <code className="text-xs break-all flex-1" style={{ color: '#1d1d1f' }}>{settings.webhookUrl}</code>
                  <button type="button" className="flex-shrink-0" style={{ color: '#aeaeb2' }}
                    onClick={() => settings.webhookUrl && copyText(settings.webhookUrl, 'Webhook URL')}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>
                  Paste this URL in your AnyPay dashboard so payment callbacks reach your hotspot.
                </p>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={savingPayment}>
              {savingPayment ? 'Saving…' : 'Save Payment Settings'}
            </button>
          </form>
        </div>
      )}

      {/* Platform AnyPay — SUPER_ADMIN only (activation + subscription revenue) */}
      {isSuperAdmin && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4" style={{ color: '#aeaeb2' }} />
              <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Platform Payments — AnyPay</h2>
            </div>
            {platform?.configured && platform.enabled && (
              <button
                type="button"
                onClick={handleTestPlatform}
                disabled={testingPlatform}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: '#f4f4f5', color: '#1d1d1f' }}
              >
                <Zap className="w-3.5 h-3.5" />
                {testingPlatform ? 'Testing…' : 'Test Connection'}
              </button>
            )}
          </div>
          <p className="text-sm mb-5" style={{ color: '#6e6e73' }}>
            Merchant activation and subscription fees are collected through this platform AnyPay account.
          </p>

          {!(platform?.configured && platform.enabled) && (
            <div className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Platform payments not configured.</strong> New merchant activation and subscription renewals will be unavailable.</span>
            </div>
          )}

          <form onSubmit={handleSavePlatform} className="space-y-5">
            <label className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: '#e5e5ea' }}>
              <div>
                <p className="text-sm font-medium" style={{ color: '#1d1d1f' }}>Enable platform payments</p>
                <p className="text-xs" style={{ color: '#6e6e73' }}>Required for merchant activation and subscription payments.</p>
              </div>
              <input
                type="checkbox"
                checked={platformEnabled}
                onChange={(e) => setPlatformEnabled(e.target.checked)}
                className="h-5 w-5 accent-blue-600"
              />
            </label>

            <div>
              <label className="label">
                AnyPay API Key{' '}
                {platform?.apiKeyMasked && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                className="input"
                placeholder={platform?.apiKeyMasked ?? 'Platform AnyPay API key'}
                value={platformKey}
                onChange={(e) => setPlatformKey(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="label">
                Access Token{' '}
                {platform?.accessTokenMasked && <span className="text-xs ml-1" style={{ color: '#34c759' }}>(set — enter to replace)</span>}
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                className="input"
                placeholder={platform?.accessTokenMasked ?? 'Optional bearer token'}
                value={platformToken}
                onChange={(e) => setPlatformToken(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="label">API Base URL</label>
              <input
                type="url"
                className="input"
                placeholder={DEFAULT_ANYAPAY_BASE_URL}
                value={platformBaseUrl}
                onChange={(e) => setPlatformBaseUrl(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary" disabled={savingPlatform}>
              {savingPlatform ? 'Saving…' : 'Save Platform Configuration'}
            </button>
          </form>
        </div>
      )}

      {isMerchant && (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-4 h-4" style={{ color: '#aeaeb2' }} />
            <h2 className="font-semibold text-sm" style={{ color: '#1d1d1f' }}>Captive Portal Notice</h2>
          </div>
          <p className="text-sm mb-5" style={{ color: '#6e6e73' }}>
            Add a support message, contact number, or operator note that appears on all of your router captive portals.
          </p>

          <form onSubmit={handleSavePortalNotice} className="space-y-5">
            <div>
              <label className="label">Display Name</label>
              <input
                type="text"
                className="input"
                value={portalNoticeName}
                onChange={(e) => setPortalNoticeName(e.target.value)}
                maxLength={60}
                placeholder="Support Desk"
              />
              <p className="text-xs mt-1.5" style={{ color: '#aeaeb2' }}>
                Appears as the sender name above the notice.
              </p>
            </div>

            <div>
              <label className="label">Message</label>
              <textarea
                className="input min-h-[112px] resize-y"
                value={portalNoticeMessage}
                onChange={(e) => setPortalNoticeMessage(e.target.value)}
                maxLength={280}
                placeholder="Need help? Call 07XXXXXXXX or visit the counter near the entrance."
              />
              <div className="mt-1.5 flex items-center justify-between text-xs" style={{ color: '#aeaeb2' }}>
                <span>Leave empty to hide the notice from the portal.</span>
                <span>{portalNoticeMessage.trim().length}/280</span>
              </div>
            </div>

            <div>
              <label className="label">Accent Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={portalNoticeColor}
                  onChange={(e) => setPortalNoticeColor(e.target.value)}
                  className="h-11 w-14 rounded-lg border cursor-pointer"
                  style={{ borderColor: '#e5e5ea', background: '#ffffff' }}
                />
                <div className="flex-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e5ea', color: '#1d1d1f' }}>
                  {portalNoticeColor.toUpperCase()}
                </div>
              </div>
            </div>

            <div
              className="rounded-2xl border px-4 py-4"
              style={{
                borderColor: `${portalNoticeColor}33`,
                background: `linear-gradient(135deg, ${portalNoticeColor}14, #f8fafc)`,
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: portalNoticeColor }}>
                {portalNoticeName.trim() || 'Portal Notice Preview'}
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: '#1d1d1f' }}>
                {portalNoticeMessage.trim() || 'Your support or announcement message will preview here.'}
              </p>
            </div>

            <button type="submit" className="btn-primary" disabled={savingPortalNotice}>
              {savingPortalNotice ? 'Saving…' : 'Save Portal Notice'}
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
