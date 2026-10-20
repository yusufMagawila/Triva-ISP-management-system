/**
 * WiFi name (SSID) rules shared by the AI profile, the executor and the
 * router script builder. The allowed set is deliberately narrow: it can never
 * contain quotes, `$`, backslashes or brackets, so a name can't break out of
 * the RouterOS string it is written into.
 */
export const SSID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,31}$/;

export function isValidSsid(value: unknown): value is string {
  return typeof value === 'string' && SSID_PATTERN.test(value);
}
