import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { Wifi } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/dashboard');
      toast.success('Welcome back!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#f5f5f7' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ background: '#0071e3' }}
          >
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: '#1d1d1f', letterSpacing: '-0.03em' }}
          >
            TRIVA
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6e6e73' }}>
            ISP Management Platform
          </p>
        </div>

        {/* Card */}
        <div className="card p-8">
          <h2
            className="text-xl font-semibold mb-6 tracking-tight"
            style={{ color: '#1d1d1f', letterSpacing: '-0.02em' }}
          >
            Sign in
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
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
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-2.5 text-base mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm mt-5" style={{ color: '#6e6e73' }}>
            New shop?{' '}
            <Link to="/register" className="font-medium hover:underline" style={{ color: '#0071e3' }}>
              Create a free account
            </Link>
          </p>
        </div>

        <p className="text-center text-xs mt-5" style={{ color: '#aeaeb2' }}>
          TRIVA © {new Date().getFullYear()} — Secure WiFi Billing
        </p>
      </div>
    </div>
  );
}

