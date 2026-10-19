import { Outlet, NavLink, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { useUiStore, applyTheme, type ThemeMode } from '../store/uiStore';
import { useT } from '../i18n';
import CommandPalette from './CommandPalette';
import {
  Wifi, LayoutDashboard, Router, CreditCard, Activity, Settings, LogOut, Building2,
  Shield, AlertTriangle, Ticket, Search, Sun, Moon, Monitor, MoreHorizontal, X, Languages,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface NavItem { to: string; labelKey: string; icon: LucideIcon }

const merchantNav: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/routers', labelKey: 'nav.routers', icon: Router },
  { to: '/plans', labelKey: 'nav.plans', icon: CreditCard },
  { to: '/sessions', labelKey: 'nav.sessions', icon: Activity },
  { to: '/payments', labelKey: 'nav.payments', icon: CreditCard },
  { to: '/vouchers', labelKey: 'nav.vouchers', icon: Ticket },
  { to: '/subscription', labelKey: 'nav.subscription', icon: Shield },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

const adminNav: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/tenants', labelKey: 'nav.tenants', icon: Building2 },
  { to: '/sessions', labelKey: 'nav.sessions', icon: Activity },
  { to: '/payments', labelKey: 'nav.payments', icon: CreditCard },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/** Items shown directly in the mobile tab bar; the rest go under "More". */
const MOBILE_PRIMARY = 4;

export default function DashboardLayout() {
  const { user, logout, fetchMe } = useAuthStore();
  const { connected, socket } = useSocketStore();
  const { theme, setTheme, lang, setLang } = useUiStore();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const nav = user?.role === 'SUPER_ADMIN' ? adminNav : merchantNav;

  // Keep the document theme in sync (including OS changes while on "system").
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // Ctrl/Cmd + K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { fetchMe(); };
    socket.on('subscription:expired', handler);
    return () => { socket.off('subscription:expired', handler); };
  }, [socket, fetchMe]);

  const paletteNav = useMemo(() => nav, [nav]);

  // Installers never see the merchant dashboard — send them to the installer app.
  if (user?.role === 'INSTALLER') return <Navigate to="/installer" replace />;

  const sub = user?.tenant?.subscription ?? null;
  const isExpired = sub?.status === 'EXPIRED' || (sub ? new Date() > new Date(sub.expiresAt) : false);
  const daysLeft = sub ? Math.max(0, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / 86_400_000)) : 0;
  const isExpiringSoon = !isExpired && sub?.status === 'ACTIVE' && daysLeft <= 7;
  const showBanner = user?.role === 'MERCHANT' && (isExpired || isExpiringSoon);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const cycleTheme = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const pageKey = nav.find((n) => location.pathname.startsWith(n.to))?.labelKey ?? 'nav.dashboard';
  const primaryMobile = nav.slice(0, MOBILE_PRIMARY);
  const moreMobile = nav.slice(MOBILE_PRIMARY);

  return (
    <div className="flex h-dvh" style={{ background: 'var(--bg)' }}>
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-60 flex-col shrink-0" style={{ background: 'var(--sidebar-bg)' }}>
        <div className="h-14 flex items-center gap-2.5 px-5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 60%, #7c3aed))' }}
          >
            <Wifi className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-white">Triva</span>
          <span className="ml-1 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden="true" />
        </div>

        {user?.tenant && (
          <div className="mx-3 mb-2 px-3 py-2 rounded-lg" style={{ background: 'var(--sidebar-hover)' }}>
            <p className="text-xs font-medium truncate" style={{ color: 'var(--sidebar-text)' }}>{user.tenant.name}</p>
          </div>
        )}

        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto" aria-label="Main">
          {nav.map(({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors duration-150"
              style={({ isActive }) => ({
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--sidebar-text)',
              })}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r" style={{ background: 'var(--accent)' }} />
                  )}
                  <Icon className="w-4 h-4 shrink-0" />
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2 px-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'animate-pulse' : ''}`} style={{ background: connected ? 'var(--success)' : '#4b5365' }} />
            <span className="text-xs" style={{ color: 'var(--sidebar-text)' }}>{connected ? t('common.live') : t('common.connecting')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
              style={{ background: 'var(--accent)', color: '#1a0f05' }}
            >
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-white">{user?.name}</p>
              <p className="text-[11px] truncate" style={{ color: 'var(--sidebar-text)' }}>{user?.role.toLowerCase().replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              title={t('common.signOut')}
              aria-label={t('common.signOut')}
              className="shrink-0 p-1.5 rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--sidebar-text)' }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-14 shrink-0 flex items-center gap-3 px-4 sm:px-6"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="lg:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
              <Wifi className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
          <h2 className="text-sm font-semibold hidden sm:block" style={{ color: 'var(--text)' }}>{t(pageKey)}</h2>

          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto sm:ml-6 flex-1 sm:flex-none sm:w-72 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-left"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            aria-label={t('common.search')}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 truncate">{t('common.search')}</span>
            <span className="kbd hidden sm:inline-flex">Ctrl K</span>
          </button>

          <div className="hidden sm:flex items-center gap-1 ml-auto">
            <button
              onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
              style={{ color: 'var(--text-2)' }}
              title={t('common.language')}
              aria-label={t('common.language')}
            >
              <Languages className="w-4 h-4" /> {lang.toUpperCase()}
            </button>
            <button
              onClick={cycleTheme}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-2)' }}
              title={`${t('common.theme')}: ${theme}`}
              aria-label={t('common.theme')}
            >
              <ThemeIcon className="w-4 h-4" />
            </button>
            <span className="ml-2 inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`} style={{ background: connected ? 'var(--success)' : 'var(--text-3)' }} />
              {connected ? t('common.live') : t('common.connecting')}
            </span>
          </div>
        </header>

        {showBanner && (
          <div
            className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm shrink-0"
            style={{ background: isExpired ? 'var(--danger)' : 'var(--accent)', color: isExpired ? '#fff' : '#1a0f05' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="truncate font-medium">
                {isExpired
                  ? 'Your subscription has expired — your hotspot is suspended for new users.'
                  : `Your subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — renew now to avoid service interruption.`}
              </span>
            </div>
            <button
              onClick={() => navigate('/subscription')}
              className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(0,0,0,0.18)', color: 'inherit' }}
            >
              {isExpired ? 'Reactivate →' : 'Renew →'}
            </button>
          </div>
        )}

        <main className="flex-1 overflow-auto pb-20 lg:pb-0">
          <div className="fade-up" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid safe-bottom"
        style={{
          gridTemplateColumns: `repeat(${primaryMobile.length + (moreMobile.length ? 1 : 0)}, minmax(0, 1fr))`,
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
        }}
        aria-label="Primary"
      >
        {primaryMobile.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium"
            style={({ isActive }) => ({ color: isActive ? 'var(--primary)' : 'var(--text-3)' })}
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {isActive && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded" style={{ background: 'var(--accent)' }} />}
                </span>
                {t(labelKey)}
              </>
            )}
          </NavLink>
        ))}
        {moreMobile.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium"
            style={{ color: 'var(--text-3)' }}
          >
            <MoreHorizontal className="w-5 h-5" />
            {t('nav.more')}
          </button>
        )}
      </nav>

      {/* "More" sheet (mobile) */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(6,7,10,0.55)' }} onClick={() => setMoreOpen(false)}>
          <div
            className="pop-in w-full rounded-t-2xl p-4 safe-bottom"
            style={{ background: 'var(--surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{user?.name}</p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close" style={{ color: 'var(--text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {moreMobile.map(({ to, labelKey, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-medium"
                  style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                >
                  <Icon className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  {t(labelKey)}
                </NavLink>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}>
                <Languages className="w-4 h-4" /> {lang === 'en' ? 'Kiswahili' : 'English'}
              </button>
              <button className="btn-secondary flex-1" onClick={cycleTheme}>
                <ThemeIcon className="w-4 h-4" /> {t(`common.${theme}`)}
              </button>
              <button className="btn-secondary" onClick={handleLogout} aria-label={t('common.signOut')}>
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={paletteNav} onLogout={handleLogout} />
    </div>
  );
}
