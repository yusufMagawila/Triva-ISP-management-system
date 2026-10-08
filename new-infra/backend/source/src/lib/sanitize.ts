/**
 * Secrets scrubber — used by the audit logger and, later, the Gemini context
 * builder. Deep-copies an object while replacing any value whose key looks
 * like a credential with a masked marker.
 *
 * Rule of thumb: if a field could authenticate someone, move money, or
 * unlock a device, it must not leave the backend in plaintext.
 */

const SENSITIVE_KEY = /pass|secret|token|apikey|api_key|api-key|credential|private|jwt|signature|provisioningkey|passwordhash|passwordenc|authorization|auth(?!or)/i;

// Keys that are safe identifiers rather than secrets even though they match
// the pattern above (e.g. "idempotencyKey" is a dedup handle, not a credential).
const SAFE_KEYS = new Set([
  'idempotencykey',
  'publickey',
  'keyref',
  'keyboard',
]);

const MASK = '[redacted]';

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SAFE_KEYS.has(k)) return false;
  return SENSITIVE_KEY.test(k);
}

/**
 * Returns a sanitized deep copy. Objects containing a `secretRef` string are
 * collapsed to `{ secretRef, present: true }` so callers see the reference
 * exists without ever seeing adjacent plaintext.
 */
export function sanitizeSecrets<T>(input: T): T {
  return scrub(input) as T;
}

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(scrub);
  }

  const obj = value as Record<string, unknown>;

  // secretRef nodes: keep the reference + a presence flag, drop everything else.
  if (typeof obj.secretRef === 'string' && obj.secretRef.startsWith('secret://')) {
    return { secretRef: obj.secretRef, present: true };
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key) && typeof val === 'string') {
      out[key] = MASK;
    } else {
      out[key] = scrub(val);
    }
  }
  return out;
}

/**
 * Scan an object for plaintext secrets at sensitive paths — used by the
 * policy validator to reject inline credentials in configuration payloads.
 * Returns the offending paths (dot-joined).
 */
export function findInlineSecrets(input: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (input === null || typeof input !== 'object') return hits;

  if (Array.isArray(input)) {
    input.forEach((v, i) => hits.push(...findInlineSecrets(v, `${path}[${i}]`)));
    return hits;
  }

  const obj = input as Record<string, unknown>;
  if (typeof obj.secretRef === 'string') return hits; // references are allowed

  for (const [key, val] of Object.entries(obj)) {
    const p = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key) && typeof val === 'string' && val.length > 0) {
      hits.push(p);
    } else {
      hits.push(...findInlineSecrets(val, p));
    }
  }
  return hits;
}
