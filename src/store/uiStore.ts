import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Lang = 'en' | 'sw';

interface UiState {
  theme: ThemeMode;
  lang: Lang;
  setTheme: (t: ThemeMode) => void;
  setLang: (l: Lang) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: 'en',
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
    }),
    { name: 'triva-ui' }
  )
);

export function resolveDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.classList.toggle('dark', resolveDark(theme));
}

/** Run before first paint so there is no light flash for dark-mode users. */
export function initTheme(): void {
  try {
    const raw = localStorage.getItem('triva-ui');
    const theme = (raw ? (JSON.parse(raw) as { state?: { theme?: ThemeMode } }).state?.theme : undefined) ?? 'system';
    applyTheme(theme);
  } catch {
    applyTheme('system');
  }
}
