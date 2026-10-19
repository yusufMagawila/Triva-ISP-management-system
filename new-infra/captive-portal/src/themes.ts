import { EVENTS, eventByKey, getActiveEvent, type Palette, type SeasonalEvent } from './events';

export type ThemeKey = 'classic' | 'sunset' | 'ocean' | 'royal' | 'fresh' | 'blossom';

export interface Theme {
  key: ThemeKey;
  name: string;
  /** null = use the shop's own brand colour (the "classic" look). */
  palette: Palette | null;
}

export const THEMES: Record<ThemeKey, Theme> = {
  classic: { key: 'classic', name: 'Brand colour', palette: null },
  sunset: { key: 'sunset', name: 'Sunset', palette: { accent: '#f97316', deep: '#be123c', glow: '#fbbf24', bg: '#fff7ed' } },
  ocean: { key: 'ocean', name: 'Ocean', palette: { accent: '#0ea5e9', deep: '#1e3a8a', glow: '#67e8f9', bg: '#f0f9ff' } },
  royal: { key: 'royal', name: 'Royal', palette: { accent: '#7c3aed', deep: '#3730a3', glow: '#f0abfc', bg: '#faf5ff' } },
  fresh: { key: 'fresh', name: 'Fresh', palette: { accent: '#10b981', deep: '#065f46', glow: '#bef264', bg: '#f0fdf4' } },
  blossom: { key: 'blossom', name: 'Blossom', palette: { accent: '#ec4899', deep: '#9d174d', glow: '#fbcfe8', bg: '#fdf2f8' } },
};

export function themeByKey(key: string | null | undefined): Theme {
  return THEMES[(key as ThemeKey) in THEMES ? (key as ThemeKey) : 'classic'];
}

export interface Look {
  theme: Theme;
  event: SeasonalEvent | null;
  /** Palette to paint with, or null to keep the tenant's own accent. */
  palette: Palette | null;
}

/**
 * Decide the look. Priority: event (when seasonal != off) > theme > brand.
 * `preview*` query params let the dashboard preview a choice before saving.
 */
export function resolveLook(input: {
  theme?: string | null;
  seasonal?: string | null;
  serverTime?: string | null;
  previewTheme?: string | null;
  previewEvent?: string | null;
}): Look {
  const theme = themeByKey(input.previewTheme ?? input.theme);
  const now = input.serverTime && !Number.isNaN(Date.parse(input.serverTime)) ? new Date(input.serverTime) : new Date();

  let event: SeasonalEvent | null = null;
  const mode = input.previewEvent ?? input.seasonal ?? 'auto';
  if (mode === 'none' || mode === 'off') event = null;
  else if (mode === 'auto') event = getActiveEvent(now);
  else event = eventByKey(mode);

  return { theme, event, palette: event?.palette ?? theme.palette };
}

/** Paint the palette (or restore the brand colour) on the document. */
export function applyLook(look: Look, brandColor: string | null | undefined): void {
  const root = document.documentElement.style;
  const brand = brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : null;
  if (look.palette) {
    root.setProperty('--accent', look.palette.accent);
    root.setProperty('--accent-deep', look.palette.deep);
    root.setProperty('--accent-glow', look.palette.glow);
    root.setProperty('--bg', look.palette.bg);
  } else {
    if (brand) root.setProperty('--accent', brand);
    root.removeProperty('--accent-deep');
    root.removeProperty('--accent-glow');
    root.removeProperty('--bg');
  }
}

export { EVENTS };
