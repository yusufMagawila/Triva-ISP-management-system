/**
 * Seasonal events for the portal. Pure logic, no external assets: the hotspot
 * walled garden only allows our own hosts, so decorations are CSS + emoji.
 * Dates are evaluated in East Africa Time using the SERVER clock (phones often
 * have wrong dates).
 */

export type EventKey =
  | 'new_year' | 'valentine' | 'easter' | 'karume_day' | 'union_day' | 'labour_day'
  | 'saba_saba' | 'nyerere_day' | 'independence_day' | 'eid' | 'christmas';

export interface Palette { accent: string; deep: string; glow: string; bg: string }

export type DecorKind = 'confetti' | 'emoji';

export interface SeasonalEvent {
  key: EventKey;
  name: string;
  emoji: string;
  greeting: { sw: string; en: string };
  palette: Palette;
  decor: { kind: DecorKind; emojis?: string[] };
  /** UTC-midnight day numbers (inclusive) of the window for a given year. */
  windows: (year: number) => Array<[number, number]>;
}

const DAY = 86_400_000;
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;
const range = (y: number, m: number, d: number, before = 0, after = 0): [number, number] => {
  const c = day(y, m, d);
  return [c - before, c + after];
};

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): { m: number; d: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: dayOfMonth };
}

/**
 * APPROXIMATE Eid dates (lunar; confirmed locally by moon sighting, so they can
 * be off by a day). Merchants can force the Eid look with seasonal = "eid".
 */
const EID_DATES: Record<number, Array<[number, number]>> = {
  2026: [[3, 20], [5, 27]],
  2027: [[3, 9], [5, 16]],
  2028: [[2, 26], [5, 5]],
  2029: [[2, 14], [4, 24]],
  2030: [[2, 4], [4, 14]],
};

const FLAG_GREEN: Palette = { accent: '#15803d', deep: '#14532d', glow: '#facc15', bg: '#f0fdf4' };

// Order = priority when windows overlap (specific national days first).
export const EVENTS: SeasonalEvent[] = [
  {
    key: 'nyerere_day', name: 'Nyerere Day', emoji: '🇹🇿',
    greeting: { sw: 'Heri ya Siku ya Nyerere', en: 'Happy Nyerere Day' },
    palette: FLAG_GREEN, decor: { kind: 'emoji', emojis: ['🇹🇿', '🌟', '💚', '💛'] },
    windows: (y) => [range(y, 10, 14, 1, 0)],
  },
  {
    key: 'independence_day', name: 'Independence Day', emoji: '🇹🇿',
    greeting: { sw: 'Heri ya Siku ya Uhuru', en: 'Happy Independence Day' },
    palette: { accent: '#0369a1', deep: '#0c4a6e', glow: '#facc15', bg: '#f0f9ff' },
    decor: { kind: 'emoji', emojis: ['🇹🇿', '🎆', '💙', '💛'] },
    windows: (y) => [range(y, 12, 9, 1, 0)],
  },
  {
    key: 'union_day', name: 'Union Day', emoji: '🤝',
    greeting: { sw: 'Heri ya Siku ya Muungano', en: 'Happy Union Day' },
    palette: { accent: '#0891b2', deep: '#155e75', glow: '#4ade80', bg: '#ecfeff' },
    decor: { kind: 'emoji', emojis: ['🇹🇿', '🤝', '🌴'] },
    windows: (y) => [range(y, 4, 26)],
  },
  {
    key: 'karume_day', name: 'Karume Day', emoji: '🌴',
    greeting: { sw: 'Heri ya Siku ya Karume', en: 'Happy Karume Day' },
    palette: { accent: '#0d9488', deep: '#134e4a', glow: '#fde047', bg: '#f0fdfa' },
    decor: { kind: 'emoji', emojis: ['🇹🇿', '🌴', '🌊'] },
    windows: (y) => [range(y, 4, 7)],
  },
  {
    key: 'saba_saba', name: 'Saba Saba', emoji: '🥁',
    greeting: { sw: 'Heri ya Sabasaba', en: 'Happy Saba Saba Day' },
    palette: { accent: '#16a34a', deep: '#14532d', glow: '#fbbf24', bg: '#f7fee7' },
    decor: { kind: 'emoji', emojis: ['🥁', '🇹🇿', '🎶'] },
    windows: (y) => [range(y, 7, 7)],
  },
  {
    key: 'labour_day', name: 'Labour Day', emoji: '🛠️',
    greeting: { sw: 'Heri ya Siku ya Wafanyakazi', en: 'Happy Workers Day' },
    palette: { accent: '#ea580c', deep: '#7c2d12', glow: '#fcd34d', bg: '#fff7ed' },
    decor: { kind: 'confetti' },
    windows: (y) => [range(y, 5, 1)],
  },
  {
    key: 'eid', name: 'Eid', emoji: '🌙',
    greeting: { sw: 'Eid Njema', en: 'Eid Mubarak' },
    palette: { accent: '#059669', deep: '#064e3b', glow: '#fde68a', bg: '#ecfdf5' },
    decor: { kind: 'emoji', emojis: ['🌙', '⭐', '✨', '🕌'] },
    windows: (y) => (EID_DATES[y] ?? []).map(([m, d]) => range(y, m, d, 1, 1)),
  },
  {
    key: 'easter', name: 'Easter', emoji: '🐣',
    greeting: { sw: 'Pasaka Njema', en: 'Happy Easter' },
    palette: { accent: '#a855f7', deep: '#6b21a8', glow: '#fde68a', bg: '#faf5ff' },
    decor: { kind: 'emoji', emojis: ['🐣', '🌷', '🥚', '✨'] },
    windows: (y) => {
      const { m, d } = easterSunday(y);
      const sunday = day(y, m, d);
      return [[sunday - 2, sunday + 1]]; // Good Friday .. Easter Monday
    },
  },
  {
    key: 'valentine', name: "Valentine's Day", emoji: '💖',
    greeting: { sw: 'Siku ya Wapendanao Njema', en: "Happy Valentine's Day" },
    palette: { accent: '#e11d48', deep: '#881337', glow: '#fda4af', bg: '#fff1f2' },
    decor: { kind: 'emoji', emojis: ['💖', '💕', '🌹'] },
    windows: (y) => [range(y, 2, 14, 1, 0)],
  },
  {
    key: 'christmas', name: 'Christmas', emoji: '🎄',
    greeting: { sw: 'Krismasi Njema', en: 'Merry Christmas' },
    palette: { accent: '#dc2626', deep: '#14532d', glow: '#bbf7d0', bg: '#fef2f2' },
    decor: { kind: 'emoji', emojis: ['❄️', '🎄', '⭐', '🎁'] },
    windows: (y) => [range(y, 12, 24, 0, 2)],
  },
  {
    key: 'new_year', name: 'New Year', emoji: '🎆',
    greeting: { sw: 'Heri ya Mwaka Mpya', en: 'Happy New Year' },
    palette: { accent: '#7c3aed', deep: '#4c1d95', glow: '#fbbf24', bg: '#faf5ff' },
    decor: { kind: 'confetti' },
    windows: (y) => [range(y, 12, 31, 0, 0), range(y, 1, 1, 0, 1)],
  },
];

export function eventByKey(key: string | null | undefined): SeasonalEvent | null {
  return EVENTS.find((e) => e.key === key) ?? null;
}

/** Calendar date in East Africa Time for an instant. */
export function eatDayNumber(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return day(get('year'), get('month'), get('day'));
}

export function getActiveEvent(now: Date): SeasonalEvent | null {
  const today = eatDayNumber(now);
  const year = new Date(today * DAY).getUTCFullYear();
  for (const ev of EVENTS) {
    for (const y of [year - 1, year, year + 1]) {
      if (ev.windows(y).some(([a, b]) => today >= a && today <= b)) return ev;
    }
  }
  return null;
}
