import { describe, it, expect } from '@jest/globals';
import {
  isPortalTheme, isPortalSeasonal, safeTheme, safeSeasonal, PORTAL_THEME_KEYS, PORTAL_EVENT_KEYS,
} from '../portal-themes';

describe('portal theme allowlists', () => {
  it('accepts every known theme and rejects anything else', () => {
    for (const k of PORTAL_THEME_KEYS) expect(isPortalTheme(k)).toBe(true);
    for (const bad of ['', 'neon', '<script>', 'CLASSIC', null, undefined, 7, {}]) expect(isPortalTheme(bad)).toBe(false);
  });

  it('accepts auto, off and every event key as seasonal mode', () => {
    expect(isPortalSeasonal('auto')).toBe(true);
    expect(isPortalSeasonal('off')).toBe(true);
    for (const k of PORTAL_EVENT_KEYS) expect(isPortalSeasonal(k)).toBe(true);
    for (const bad of ['always', 'christmas ', '', null, undefined, 1]) expect(isPortalSeasonal(bad)).toBe(false);
  });

  it('falls back to safe defaults for unexpected stored values', () => {
    expect(safeTheme('garbage')).toBe('classic');
    expect(safeSeasonal('garbage')).toBe('auto');
    expect(safeTheme('ocean')).toBe('ocean');
    expect(safeSeasonal('eid')).toBe('eid');
  });

  it('covers the Tanzania national days the portal ships', () => {
    for (const k of ['nyerere_day', 'independence_day', 'union_day', 'karume_day', 'saba_saba', 'labour_day']) {
      expect(PORTAL_EVENT_KEYS).toContain(k);
    }
  });
});
