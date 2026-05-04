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
  CircleDot,
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
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-gray-200">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg text-gray-900">TRIVA</span>
        </div>

        {/* Tenant info */}
        {user?.tenant && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Shop</p>
            <p className="font-semibold text-gray-800 truncate">{user.tenant.name}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 space-y-3">
          {/* Connection status */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CircleDot
              className={`w-3 h-3 ${connected ? 'text-green-500' : 'text-gray-400'}`}
            />
            <span>{connected ? 'Live updates active' : 'Connecting...'}</span>
          </div>

          {/* User info */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center">
              <span className="text-xs font-bold text-brand-700">
                {user?.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role.toLowerCase().replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
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
