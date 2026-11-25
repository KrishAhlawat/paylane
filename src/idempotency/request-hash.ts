import { createHash } from 'crypto';

/**
 * Deterministic JSON: object keys sorted, undefined values dropped, so
 * `{a:1,b:2}` and `{b:2,a:1}` hash identically. Array order is preserved.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/** Fingerprint of a request, used to detect an Idempotency-Key reused with a different payload. */
export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path}\n${canonicalize(body)}`)
    .digest('hex');
}
