import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import ActivatePage from './pages/Activate';
import DashboardLayout from './components/DashboardLayout';
import MerchantDashboard from './pages/dashboard/MerchantDashboard';
import AdminDashboard from './pages/dashboard/AdminDashboard';
import RoutersPage from './pages/routers/RoutersPage';
import PlansPage from './pages/plans/PlansPage';
import SessionsPage from './pages/sessions/SessionsPage';
import PaymentsPage from './pages/payments/PaymentsPage';
import TenantsPage from './pages/admin/TenantsPage';
import SettingsPage from './pages/settings/SettingsPage';
import SubscriptionPage from './pages/subscription/SubscriptionPage';
import VouchersPage from './pages/vouchers/VouchersPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
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
        path="/"
        element={
          <PrivateRoute>
            <ActiveMerchantRoute>
              <DashboardLayout />
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
  );
}
