import { createHash, randomBytes } from 'crypto';

// Pure helpers (no DB, no Nest) so they are easy to unit test.

export const API_KEY_PREFIX = 'pl_test_';

/** 24 random bytes -> 32 base64url chars. Shown to the merchant once, only the hash is stored. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString('base64url');
}

export function generateWebhookSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const BEARER_PATTERN = /^Bearer (pl_test_[A-Za-z0-9_-]{32})$/;

/** Returns the API key from an `Authorization: Bearer <key>` header, or null if malformed. */
export function parseBearerKey(header: string | undefined): string | null {
  if (!header) return null;
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : null;
}
