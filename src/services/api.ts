import axios from 'axios';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Response interceptor: unwrap or throw
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.error ??
      err.response?.data?.message ??
      err.message ??
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

export default api;
