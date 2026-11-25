import { MAX_AMOUNT, createPaymentSchema } from './create-payment.schema';

const valid = { amount: 10_000, payment_method_token: 'tok_approve' };

describe('createPaymentSchema', () => {
  it('accepts a minimal valid body and defaults currency to INR', () => {
    const parsed = createPaymentSchema.parse(valid);
    expect(parsed.currency).toBe('INR');
    expect(parsed.amount).toBe(10_000);
  });

  it('accepts metadata', () => {
    expect(
      createPaymentSchema.safeParse({ ...valid, metadata: { order_id: 'ord_1' } }).success,
    ).toBe(true);
  });

  it.each([
    ['float amount', { ...valid, amount: 99.5 }],
    ['zero amount', { ...valid, amount: 0 }],
    ['negative amount', { ...valid, amount: -100 }],
    ['string amount', { ...valid, amount: '10000' }],
    ['amount above the cap', { ...valid, amount: MAX_AMOUNT + 1 }],
    ['unsupported currency', { ...valid, currency: 'USD' }],
    ['missing token', { amount: 10_000 }],
    ['token without tok_ prefix', { ...valid, payment_method_token: '4242424242424242' }],
    ['unknown field', { ...valid, card_number: '4242424242424242' }],
    ['non-string metadata value', { ...valid, metadata: { n: 1 } }],
  ])('rejects %s', (_label, body) => {
    expect(createPaymentSchema.safeParse(body).success).toBe(false);
  });

  it('rejects more than 20 metadata keys', () => {
    const metadata = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
    expect(createPaymentSchema.safeParse({ ...valid, metadata }).success).toBe(false);
  });

  it('accepts the maximum amount', () => {
    expect(createPaymentSchema.safeParse({ ...valid, amount: MAX_AMOUNT }).success).toBe(true);
  });
});
