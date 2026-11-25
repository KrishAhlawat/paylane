/** The subset of a payment row the API exposes. Prisma's Payment satisfies this structurally. */
export interface PaymentRecord {
  id: string;
  amount: bigint;
  currency: string;
  status: string;
  capturedAmount: bigint;
  refundedAmount: bigint;
  failureReason: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface PublicPayment {
  id: string;
  object: 'payment';
  amount: number;
  currency: string;
  status: string;
  captured_amount: number;
  refunded_amount: number;
  failure_reason: string | null;
  metadata: Record<string, string> | null;
  created_at: string;
}

/** BigInt cannot go through JSON.stringify. Amounts are capped far below 2^53, so Number is exact. */
export function toPublicPayment(p: PaymentRecord): PublicPayment {
  return {
    id: p.id,
    object: 'payment',
    amount: Number(p.amount),
    currency: p.currency,
    status: p.status,
    captured_amount: Number(p.capturedAmount),
    refunded_amount: Number(p.refundedAmount),
    failure_reason: p.failureReason,
    metadata: (p.metadata as Record<string, string> | null) ?? null,
    created_at: p.createdAt.toISOString(),
  };
}
