import {
  API_KEY_PREFIX,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  parseBearerKey,
} from './api-key';

describe('api keys', () => {
  it('generates keys with the expected prefix and length', () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^pl_test_[A-Za-z0-9_-]{32}$/);
  });

  it('generates a different key every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
  });

  it('generates webhook secrets with the whsec_ prefix', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
  });

  it('hashes deterministically to 64 hex chars and never equals the key', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(key);
    expect(hashApiKey(key)).not.toBe(hashApiKey(generateApiKey()));
  });
});

describe('parseBearerKey', () => {
  const key = generateApiKey();

  it('extracts a valid key', () => {
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
  });

  it('rejects missing, wrong-scheme, wrong-prefix and short keys', () => {
    expect(parseBearerKey(undefined)).toBeNull();
    expect(parseBearerKey('')).toBeNull();
    expect(parseBearerKey(key)).toBeNull();
    expect(parseBearerKey(`Basic ${key}`)).toBeNull();
    expect(parseBearerKey('Bearer sk_live_' + 'a'.repeat(32))).toBeNull();
    expect(parseBearerKey('Bearer pl_test_short')).toBeNull();
    expect(parseBearerKey(`Bearer ${key} extra`)).toBeNull();
  });
});
