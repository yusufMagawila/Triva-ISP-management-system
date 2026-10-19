import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
const ActivatePage = lazy(() => import('./pages/Activate'));
import DashboardLayout from './components/DashboardLayout';
const MerchantDashboard = lazy(() => import('./pages/dashboard/MerchantDashboard'));
const AdminDashboard = lazy(() => import('./pages/dashboard/AdminDashboard'));
const RoutersPage = lazy(() => import('./pages/routers/RoutersPage'));
const PlansPage = lazy(() => import('./pages/plans/PlansPage'));
const SessionsPage = lazy(() => import('./pages/sessions/SessionsPage'));
const PaymentsPage = lazy(() => import('./pages/payments/PaymentsPage'));
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const SubscriptionPage = lazy(() => import('./pages/subscription/SubscriptionPage'));
const VouchersPage = lazy(() => import('./pages/vouchers/VouchersPage'));
const InstallerJobsPage = lazy(() => import('./pages/installer/InstallerJobsPage'));
const InstallationDetailPage = lazy(() => import('./pages/installer/InstallationDetailPage'));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Installer accounts only reach the installer namespace — no merchant dashboard. */
function InstallerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'INSTALLER' && user.role !== 'MERCHANT' && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Redirects PENDING merchants to /activate before they can use the dashboard */
function ActiveMerchantRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'MERCHANT' && user.tenant?.status === 'PENDING') {
    return <Navigate to="/activate" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { fetchMe, user } = useAuthStore();
  const { connect, disconnect } = useSocketStore();

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (user?.tenantId) {
      connect(user.tenantId);
    }
    return () => disconnect();
  }, [user?.tenantId, connect, disconnect]);

  return (
    <Suspense fallback={<div className="min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg)' }}><div className="spinner" /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/activate"
        element={
          <PrivateRoute>
            <ActivatePage />
          </PrivateRoute>
        }
      />

      <Route
        path="/installer"
        element={
          <PrivateRoute>
            <InstallerRoute>
              <InstallerJobsPage />
            </InstallerRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/installer/jobs/:id"
        element={
          <PrivateRoute>
            <InstallerRoute>
              <InstallationDetailPage />
            </InstallerRoute>
          </PrivateRoute>
        }
      />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <ActiveMerchantRoute>
              {user?.role === 'INSTALLER' ? <Navigate to="/installer" replace /> : <DashboardLayout />}
            </ActiveMerchantRoute>
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            user?.role === 'SUPER_ADMIN' ? <AdminDashboard /> : <MerchantDashboard />
          }
        />
        <Route path="routers" element={<RoutersPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="vouchers" element={<VouchersPage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
        <Route
          path="tenants"
          element={
            <AdminRoute>
              <TenantsPage />
            </AdminRoute>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
}
