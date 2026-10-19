/**
 * Allowlists for the captive-portal look. The portal renders these keys from
 * its own bundled palettes/decorations (no external assets — the hotspot
 * walled garden only allows our own hosts), so the backend only stores and
 * validates the keys.
 */

export const PORTAL_THEME_KEYS = ['classic', 'sunset', 'ocean', 'royal', 'fresh', 'blossom'] as const;
export type PortalThemeKey = (typeof PORTAL_THEME_KEYS)[number];

export const PORTAL_EVENT_KEYS = [
  'new_year',
  'valentine',
  'easter',
  'karume_day',
  'union_day',
  'labour_day',
  'saba_saba',
  'nyerere_day',
  'independence_day',
  'eid',
  'christmas',
] as const;
export type PortalEventKey = (typeof PORTAL_EVENT_KEYS)[number];

/** portalSeasonal: 'auto' follows the calendar, 'off' disables, or force one event. */
export const PORTAL_SEASONAL_MODES = ['auto', 'off', ...PORTAL_EVENT_KEYS] as const;

export const DEFAULT_PORTAL_THEME: PortalThemeKey = 'classic';
export const DEFAULT_PORTAL_SEASONAL = 'auto';

export function isPortalTheme(v: unknown): v is PortalThemeKey {
  return typeof v === 'string' && (PORTAL_THEME_KEYS as readonly string[]).includes(v);
}

export function isPortalSeasonal(v: unknown): boolean {
  return typeof v === 'string' && (PORTAL_SEASONAL_MODES as readonly string[]).includes(v);
}

/** Safe values for responses even if a row holds something unexpected. */
export function safeTheme(v: unknown): PortalThemeKey {
  return isPortalTheme(v) ? v : DEFAULT_PORTAL_THEME;
}
export function safeSeasonal(v: unknown): string {
  return isPortalSeasonal(v) ? (v as string) : DEFAULT_PORTAL_SEASONAL;
}
