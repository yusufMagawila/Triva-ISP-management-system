/**
 * Tanzanian mobile number handling.
 * Accepted inputs: 07XXXXXXXX, 06XXXXXXXX, 255XXXXXXXXX, +255XXXXXXXXX.
 * Normalized output: 255XXXXXXXXX (what AnyPay expects).
 */

const LOCAL = /^0[67]\d{8}$/;
const INTL = /^(?:\+?255)[67]\d{8}$/;

export function normalizeTzPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  if (LOCAL.test(digits)) return `255${digits.slice(1)}`;
  if (INTL.test(digits)) return digits.replace(/^\+/, '');
  return null;
}

export function isValidTzPhone(raw: string): boolean {
  return normalizeTzPhone(raw) !== null;
}

export function phoneHintError(raw: string): string | null {
  if (!raw.trim()) return 'Enter your mobile number';
  if (!isValidTzPhone(raw)) return 'Enter a valid number, e.g. 0712 345 678';
  return null;
}
