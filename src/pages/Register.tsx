import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Wifi, Eye, EyeOff } from 'lucide-react';

interface RegisterResponse {
  data: {
    token: string;
    activationRequired?: boolean;
    user: {
      id: string;
      email: string;
      name: string;
      role: 'MERCHANT';
      tenantId: string;
      tenant: { id: string; name: string; slug: string; status: string; subscription: { status: string; expiresAt: string } | null };
    };
  };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({
    shopName: '',
    merchantName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<RegisterResponse>('/auth/register', {
        shopName: form.shopName,
        merchantName: form.merchantName,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
      });
      setAuth(res.data.data.token, res.data.data.user);
      toast.success('Account created! Please activate your account.');
      navigate('/activate');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-200">
            <Wifi className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Create Your Shop</h1>
          <p className="text-gray-500 mt-1">Start your 30-day free trial — no card required</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Shop info */}
            <div className="pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Shop Details</p>
              <div className="space-y-4">
                <div>
                  <label className="label">Shop / Business Name</label>
                  <input
                    className="input"
                    value={form.shopName}
                    onChange={set('shopName')}
                    required
                    placeholder="Karibu WiFi Shop"
                    minLength={2}
                  />
                </div>
              </div>
            </div>

            {/* Account info */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Your Account</p>
              <div className="space-y-4">
                <div>
                  <label className="label">Your Full Name</label>
                  <input
                    className="input"
                    value={form.merchantName}
                    onChange={set('merchantName')}
                    required
                    placeholder="John Doe"
                    minLength={2}
                  />
                </div>
                <div>
                  <label className="label">Email Address</label>
                  <input
                    type="email"
                    className="input"
                    value={form.email}
                    onChange={set('email')}
                    required
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="label">Phone Number (optional)</label>
                  <input
                    type="tel"
                    className="input"
                    value={form.phone}
                    onChange={set('phone')}
                    placeholder="+255 7XX XXX XXX"
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      value={form.password}
                      onChange={set('password')}
                      required
                      minLength={8}
                      placeholder="Min. 8 characters"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <input
                    type="password"
                    className="input"
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    required
                    placeholder="Repeat password"
                  />
                </div>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full py-3 text-base" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account & Start Trial'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By registering you agree to our Terms of Service. Your 30-day trial starts immediately.
        </p>
      </div>
    </div>
  );
}
