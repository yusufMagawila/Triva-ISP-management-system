import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { useT } from '../i18n';
import toast from 'react-hot-toast';
import { Wifi, Zap, ShieldCheck, LineChart, Languages } from 'lucide-react';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { lang, setLang } = useUiStore();
  const pitches = [
    { icon: Zap, text: t('login.pitch1') },
    { icon: ShieldCheck, text: t('login.pitch2') },
    { icon: LineChart, text: t('login.pitch3') },
  ];
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]" style={{ background: 'var(--bg)' }}>
      {/* Brand panel */}
      <aside
        className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 text-white"
        style={{ background: 'var(--sidebar-bg)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(60% 50% at 15% 10%, color-mix(in srgb, var(--primary) 55%, transparent) 0, transparent 70%),' +
              'radial-gradient(50% 45% at 95% 95%, color-mix(in srgb, var(--accent) 45%, transparent) 0, transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), #7c3aed)' }}>
            <Wifi className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Triva</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden="true" />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[38px] leading-[1.1] font-semibold tracking-tight">
            Turn any router into a <span style={{ color: 'var(--accent)' }}>WiFi business</span>.
          </h2>
          <ul className="mt-8 space-y-4">
            {pitches.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px]" style={{ color: 'rgba(255,255,255,0.82)' }}>
                <span className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.09)' }}>
                  <Icon className="w-4 h-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          © {new Date().getFullYear()} Triva · Secure WiFi billing
        </p>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center p-5 sm:p-10">
        <button
          onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}
          className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          style={{ color: 'var(--text-2)' }}
          aria-label={t('common.language')}
        >
          <Languages className="w-4 h-4" /> {lang.toUpperCase()}
        </button>
        <div className="w-full max-w-sm fade-up">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
              <Wifi className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Triva</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/dashboard');
      toast.success(t('login.welcome'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{t('login.title')}</h1>
      <p className="text-sm mt-1.5 mb-7" style={{ color: 'var(--text-2)' }}>{t('login.subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">{t('login.email')}</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('login.password')}</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn-primary w-full py-2.5 mt-2" disabled={isLoading}>
          {isLoading ? t('login.signingIn') : t('login.submit')}
        </button>
      </form>

      <p className="text-center text-sm mt-6" style={{ color: 'var(--text-2)' }}>
        {t('login.newShop')}{' '}
        <Link to="/register" className="font-semibold hover:underline" style={{ color: 'var(--primary)' }}>
          {t('login.create')}
        </Link>
      </p>
    </AuthShell>
  );
}
