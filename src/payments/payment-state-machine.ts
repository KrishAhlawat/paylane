/**
 * Payment lifecycle as a pure state machine (no DB, no I/O).
 * Keeping it pure makes every rule unit-testable and keeps the services thin.
 *
 *   CREATED ──► AUTHORIZED ──► CAPTURED ──► PARTIALLY_REFUNDED ──► REFUNDED
 *      │            │              └──────────────────────────────► REFUNDED
 *      │            └──► VOIDED
 *      └──► FAILED  (also reachable from AUTHORIZED, e.g. capture rejected by bank)
 */
export enum PaymentStatus {
  CREATED = 'CREATED',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
  FAILED = 'FAILED',
}

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.CREATED]: [PaymentStatus.AUTHORIZED, PaymentStatus.FAILED],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.VOIDED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.CAPTURED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  // A partially refunded payment can be refunded again, so it may stay in the same state.
  [PaymentStatus.PARTIALLY_REFUNDED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.VOIDED]: [],
  [PaymentStatus.FAILED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid payment transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function allowedNext(status: PaymentStatus): readonly PaymentStatus[] {
  return TRANSITIONS[status];
}

/**
 * Decide the status after a refund, given integer minor-unit amounts.
 * Throws if the refund would exceed what was captured.
 */
export function statusAfterRefund(
  current: PaymentStatus,
  capturedAmount: bigint,
  alreadyRefunded: bigint,
  refundAmount: bigint,
): PaymentStatus {
  if (refundAmount <= 0n) {
    throw new RangeError('Refund amount must be positive');
  }
  const totalRefunded = alreadyRefunded + refundAmount;
  if (totalRefunded > capturedAmount) {
    throw new RangeError('Refund exceeds captured amount');
  }
  const next =
    totalRefunded === capturedAmount
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
  assertTransition(current, next);
  return next;
}
