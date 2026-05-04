import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../services/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MERCHANT';
  tenantId: string | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    subscription: { status: string; expiresAt: string } | null;
  } | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await api.post<{ data: { token: string; user: User } }>('/auth/login', {
            email,
            password,
          });
          const { token, user } = res.data.data;
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          set({ token, user, isLoading: false });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: () => {
        delete api.defaults.headers.common['Authorization'];
        set({ user: null, token: null });
      },

      fetchMe: async () => {
        const { token } = get();
        if (!token) return;
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        try {
          const res = await api.get<{ data: User }>('/auth/me');
          set({ user: res.data.data });
        } catch {
          set({ user: null, token: null });
        }
      },
    }),
    {
      name: 'triva-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);
