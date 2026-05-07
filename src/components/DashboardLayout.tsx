import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import {
  Wifi,
  LayoutDashboard,
  Router,
  CreditCard,
  Users,
  Activity,
  Settings,
  LogOut,
  Building2,
  Shield,
} from 'lucide-react';

const merchantNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/routers', label: 'Routers', icon: Router },
  { to: '/plans', label: 'Plans', icon: CreditCard },
  { to: '/sessions', label: 'Sessions', icon: Activity },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/subscription', label: 'Subscription', icon: Shield },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const adminNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
  { to: '/sessions', label: 'Sessions', icon: Activity },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const { connected } = useSocketStore();
  const navigate = useNavigate();

  const nav = user?.role === 'SUPER_ADMIN' ? adminNav : merchantNav;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen" style={{ background: '#f5f5f7' }}>
      {/* Sidebar */}
      <aside
        className="w-60 flex flex-col bg-white"
        style={{ borderRight: '1px solid #e8e8ed' }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#0071e3' }}
          >
            <Wifi className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-base tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.02em' }}>
            TRIVA
          </span>
        </div>

        {/* Tenant chip */}
        {user?.tenant && (
          <div className="mx-3 mb-1 px-3 py-2 rounded-xl" style={{ background: '#f5f5f7' }}>
            <p className="text-xs font-medium truncate" style={{ color: '#6e6e73' }}>{user.tenant.name}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'text-white'
                    : 'hover:bg-gray-50'
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? { background: '#0071e3', color: 'white' }
                  : { color: '#3a3a3c' }
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 space-y-2" style={{ borderTop: '1px solid #f0f0f5' }}>
          {/* Live indicator */}
          <div className="flex items-center gap-2 px-1">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <span className="text-xs" style={{ color: '#6e6e73' }}>
              {connected ? 'Live' : 'Connecting…'}
            </span>
          </div>

          {/* User row */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
              style={{ background: '#0071e3' }}
            >
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: '#1d1d1f' }}>{user?.name}</p>
              <p className="text-xs truncate" style={{ color: '#6e6e73' }}>
                {user?.role.toLowerCase().replace('_', ' ')}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="flex-shrink-0 transition-colors duration-150 hover:text-red-500"
              style={{ color: '#aeaeb2' }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

