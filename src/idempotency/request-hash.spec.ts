import { canonicalize, hashRequest } from './request-hash';

describe('canonicalize', () => {
  it('ignores object key order, including nested objects', () => {
    expect(canonicalize({ a: 1, b: { y: 2, x: 1 } })).toBe(
      canonicalize({ b: { x: 1, y: 2 }, a: 1 }),
    );
  });

  it('keeps array order significant', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('drops undefined object values', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('distinguishes types that look alike', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: '1' }));
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });
});

describe('hashRequest', () => {
  const body = { amount: 10_000, currency: 'INR', payment_method_token: 'tok_approve' };

  it('is a 64-char hex digest', () => {
    expect(hashRequest('POST', '/payments', body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same request regardless of key order', () => {
    const reordered = { payment_method_token: 'tok_approve', currency: 'INR', amount: 10_000 };
    expect(hashRequest('POST', '/payments', body)).toBe(hashRequest('POST', '/payments', reordered));
  });

  it('changes when any field changes', () => {
    const h = hashRequest('POST', '/payments', body);
    expect(hashRequest('POST', '/payments', { ...body, amount: 10_001 })).not.toBe(h);
    expect(hashRequest('POST', '/payments', { ...body, payment_method_token: 'tok_decline' })).not.toBe(h);
  });

  it('changes with method or path', () => {
    const h = hashRequest('POST', '/payments', body);
    expect(hashRequest('PUT', '/payments', body)).not.toBe(h);
    expect(hashRequest('POST', '/refunds', body)).not.toBe(h);
  });

  it('treats the method case-insensitively', () => {
    expect(hashRequest('post', '/payments', body)).toBe(hashRequest('POST', '/payments', body));
  });
});
