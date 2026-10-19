import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import PortalLookSettings from './PortalLookSettings';
import { Tabs } from '../../components/ui';
import { Settings, KeyRound, CreditCard, Eye, EyeOff, AlertTriangle, CheckCircle, Zap, Copy, UserRound, Palette, ShieldCheck } from 'lucide-react';

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
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  const [tab, setTab] = useState<'profile' | 'payments' | 'portal' | 'security'>('profile');
  const tabs = [
    { key: 'profile' as const, label: 'Profile', icon: UserRound },
    { key: 'payments' as const, label: 'Payments', icon: CreditCard },
    ...(isMerchant ? [{ key: 'portal' as const, label: 'Portal', icon: Palette }] : []),
    { key: 'security' as const, label: 'Security', icon: ShieldCheck },
  ];

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

  /** One-step setup: save the key, enable payments, verify it works. */
  async function handleConnectAnypay(e: React.FormEvent) {
    e.preventDefault();
    const key = anypayKey.trim();
    if (!key) return;
    setSavingPayment(true);
    try {
      await api.put('/payment-settings', { anypayApiKey: key, anypayEnabled: true });
      let ok = false;
      let message = '';
      try {
        const r = await api.post<{ success: boolean; message: string }>('/payment-settings/test', {});
        ok = r.data.success;
        message = r.data.message;
      } catch (err) {
        message = err instanceof Error ? err.message : 'Connection test failed';
      }
      if (ok) {
        toast.success('AnyPay connected. Customers can pay now.');
      } else {
        await api.put('/payment-settings', { anypayEnabled: false });
        toast.error('We could not verify this key. ' + message);
      }
      const r = await api.get<{ data: PaymentSettingsData }>('/payment-settings');
      setSettings(r.data.data);
      setAnypayEnabled(ok);
      setAnypayKey('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the key');
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
    <div className="p-4 sm:p-7 space-y-0 max-w-3xl mx-auto [&>*+*]:mt-6">
      <div>
        <h1 className="text-[22px] sm:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.03em' }}>
          Settings
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>Manage your account</p>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {/* Account Info */}
      {tab === 'profile' && <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <Settings className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Account Info</h2>
        </div>
        <dl className="space-y-3 text-sm">
          {[
            { label: 'Name', value: user?.name },
            { label: 'Email', value: user?.email },
            { label: 'Role', value: user?.role.toLowerCase().replace('_', ' ') },
            ...(user?.tenant ? [{ label: 'Shop', value: user.tenant.name }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-4">
              <dt className="w-16 font-medium" style={{ color: 'var(--text-3)' }}>{label}</dt>
              <dd className="capitalize" style={{ color: 'var(--text)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>}

      {/* AnyPay — merchant gateway configuration */}
      {isMerchant && tab === 'payments' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Payments — AnyPay</h2>
            </div>
            {settings?.configured && (
              <button
                type="button"
                onClick={handleTestGateway}
                disabled={testing}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
              >
                <Zap className="w-3.5 h-3.5" />
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            )}
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
            Customers pay by mobile money and the money goes straight to your AnyPay account. Your key is stored encrypted.
          </p>

          {/* Status badge */}
          {!isReady ? (
            <div className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)', color: 'color-mix(in srgb, var(--warning) 62%, var(--text))' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Payments are not connected yet.</strong> Paste your AnyPay API key below so customers can pay.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-5 text-sm rounded-xl p-3.5"
              style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', color: 'var(--success)' }}>
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span><strong>AnyPay Tanzania</strong> is active — payments go directly to your account.</span>
            </div>
          )}

          <form onSubmit={handleConnectAnypay} className="space-y-4">
            <div>
              <label className="label">
                AnyPay API key{' '}
                {settings?.configured && <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>(connected — paste a new key to replace it)</span>}
              </label>
              <div className="relative">
                <input
                  type={showKeys ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder={settings?.anypayApiKey ?? 'Paste your AnyPay API key'}
                  value={anypayKey}
                  onChange={(e) => setAnypayKey(e.target.value)}
                  autoComplete="off"
                />
                <button type="button" onClick={() => setShowKeys((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }}
                  aria-label={showKeys ? 'Hide key' : 'Show key'}>
                  {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
                Find it in your AnyPay account under API Keys. That is all we need. Everything else is handled for you.
              </p>
            </div>
            <button type="submit" className="btn-primary" disabled={savingPayment || !anypayKey.trim()}>
              {savingPayment ? 'Connecting…' : settings?.configured ? 'Update key' : 'Connect AnyPay'}
            </button>
          </form>

          <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-semibold"
              style={{ color: 'var(--text-2)' }}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced options
            </button>

            {showAdvanced && (
              <form onSubmit={handleSavePaymentSettings} className="space-y-5 mt-4">
                <label className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Accept payments</p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>Turn off to pause customer payments without removing your key.</p>
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
                    Access token{' '}
                    {settings?.anypayAccessToken && <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>(set — enter to replace)</span>}
                  </label>
                  <input
                    type={showKeys ? 'text' : 'password'}
                    className="input"
                    placeholder={settings?.anypayAccessToken ?? 'Only if AnyPay gave you one'}
                    value={anypayToken}
                    onChange={(e) => setAnypayToken(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="label">API address</label>
                  <input
                    type="url"
                    className="input"
                    placeholder={DEFAULT_ANYAPAY_BASE_URL}
                    value={anypayBaseUrl}
                    onChange={(e) => setAnypayBaseUrl(e.target.value)}
                  />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>Leave empty unless AnyPay told you to change it.</p>
                </div>

                {settings?.webhookUrl && (
                  <div>
                    <label className="label">Instant confirmation link (optional)</label>
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                      <code className="text-xs break-all flex-1" style={{ color: 'var(--text)' }}>{settings.webhookUrl}</code>
                      <button type="button" className="flex-shrink-0" style={{ color: 'var(--text-3)' }}
                        onClick={() => settings.webhookUrl && copyText(settings.webhookUrl, 'Link')}
                        aria-label="Copy link">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
                      You do not need this. Payments are confirmed automatically within seconds. Add it in AnyPay only if you want confirmations to be instant.
                    </p>
                  </div>
                )}

                <button type="submit" className="btn-secondary" disabled={savingPayment}>
                  {savingPayment ? 'Saving…' : 'Save advanced options'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Platform AnyPay — SUPER_ADMIN only (activation + subscription revenue) */}
      {isSuperAdmin && tab === 'payments' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Platform Payments — AnyPay</h2>
            </div>
            {platform?.configured && platform.enabled && (
              <button
                type="button"
                onClick={handleTestPlatform}
                disabled={testingPlatform}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
              >
                <Zap className="w-3.5 h-3.5" />
                {testingPlatform ? 'Testing…' : 'Test Connection'}
              </button>
            )}
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
            Merchant activation and subscription fees are collected through this platform AnyPay account.
          </p>

          {!(platform?.configured && platform.enabled) && (
            <div className="flex items-start gap-2 rounded-xl p-3.5 mb-5 text-sm"
              style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)', color: 'color-mix(in srgb, var(--warning) 62%, var(--text))' }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Platform payments not configured.</strong> New merchant activation and subscription renewals will be unavailable.</span>
            </div>
          )}

          <form onSubmit={handleSavePlatform} className="space-y-5">
            <label className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Enable platform payments</p>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>Required for merchant activation and subscription payments.</p>
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
                {platform?.apiKeyMasked && <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>(set — enter to replace)</span>}
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
                {platform?.accessTokenMasked && <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>(set — enter to replace)</span>}
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

      {isMerchant && tab === 'portal' && (
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Captive Portal Notice</h2>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
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
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
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
              <div className="mt-1.5 flex items-center justify-between text-xs" style={{ color: 'var(--text-3)' }}>
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
                  style={{ borderColor: 'var(--border)', background: '#ffffff' }}
                />
                <div className="flex-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
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
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text)' }}>
                {portalNoticeMessage.trim() || 'Your support or announcement message will preview here.'}
              </p>
            </div>

            <button type="submit" className="btn-primary" disabled={savingPortalNotice}>
              {savingPortalNotice ? 'Saving…' : 'Save Portal Notice'}
            </button>
          </form>
        </div>
      )}

      {isMerchant && tab === 'portal' && <PortalLookSettings />}

      {/* Change Password */}
      {tab === 'security' && <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <KeyRound className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Change Password</h2>
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
      </div>}
    </div>
  );
}
