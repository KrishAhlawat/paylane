import { PaymentRecord, toPublicPayment } from './payment.serializer';

const record: PaymentRecord = {
  id: 'pay_1',
  amount: 10_000n,
  currency: 'INR',
  status: 'AUTHORIZED',
  capturedAmount: 0n,
  refundedAmount: 0n,
  failureReason: null,
  metadata: null,
  createdAt: new Date('2026-10-25T10:00:00.000Z'),
};

describe('toPublicPayment', () => {
  it('converts bigint amounts to numbers so the result is JSON-serializable', () => {
    const out = toPublicPayment(record);
    expect(out.amount).toBe(10_000);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('maps fields to the snake_case public shape', () => {
    expect(toPublicPayment(record)).toEqual({
      id: 'pay_1',
      object: 'payment',
      amount: 10_000,
      currency: 'INR',
      status: 'AUTHORIZED',
      captured_amount: 0,
      refunded_amount: 0,
      failure_reason: null,
      metadata: null,
      created_at: '2026-10-25T10:00:00.000Z',
    });
  });

  it('passes through metadata and failure reason', () => {
    const out = toPublicPayment({
      ...record,
      status: 'FAILED',
      failureReason: 'bank_timeout',
      metadata: { order_id: 'ord_1' },
    });
    expect(out.failure_reason).toBe('bank_timeout');
    expect(out.metadata).toEqual({ order_id: 'ord_1' });
  });
});
