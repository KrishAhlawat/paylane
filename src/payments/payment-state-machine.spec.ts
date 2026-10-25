import {
  PaymentStatus as S,
  InvalidTransitionError,
  allowedNext,
  assertTransition,
  canTransition,
  isTerminal,
  statusAfterRefund,
} from './payment-state-machine';

describe('payment state machine', () => {
  it('allows the happy path: created -> authorized -> captured -> refunded', () => {
    expect(canTransition(S.CREATED, S.AUTHORIZED)).toBe(true);
    expect(canTransition(S.AUTHORIZED, S.CAPTURED)).toBe(true);
    expect(canTransition(S.CAPTURED, S.REFUNDED)).toBe(true);
  });

  it('allows voiding only from AUTHORIZED', () => {
    expect(canTransition(S.AUTHORIZED, S.VOIDED)).toBe(true);
    expect(canTransition(S.CREATED, S.VOIDED)).toBe(false);
    expect(canTransition(S.CAPTURED, S.VOIDED)).toBe(false);
  });

  it('rejects skipping states', () => {
    expect(canTransition(S.CREATED, S.CAPTURED)).toBe(false);
    expect(canTransition(S.CREATED, S.REFUNDED)).toBe(false);
    expect(canTransition(S.AUTHORIZED, S.REFUNDED)).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(canTransition(S.CAPTURED, S.AUTHORIZED)).toBe(false);
    expect(canTransition(S.AUTHORIZED, S.CREATED)).toBe(false);
  });

  it('treats REFUNDED, VOIDED and FAILED as terminal', () => {
    for (const s of [S.REFUNDED, S.VOIDED, S.FAILED]) {
      expect(isTerminal(s)).toBe(true);
      expect(allowedNext(s)).toHaveLength(0);
    }
    expect(isTerminal(S.CAPTURED)).toBe(false);
  });

  it('assertTransition throws InvalidTransitionError with from/to', () => {
    expect.assertions(3);
    try {
      assertTransition(S.REFUNDED, S.CAPTURED);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).from).toBe(S.REFUNDED);
      expect((e as InvalidTransitionError).to).toBe(S.CAPTURED);
    }
  });

  it('never allows a transition out of a terminal state (exhaustive)', () => {
    const all = Object.values(S);
    for (const from of all.filter(isTerminal)) {
      for (const to of all) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe('statusAfterRefund', () => {
  it('partial refund -> PARTIALLY_REFUNDED', () => {
    expect(statusAfterRefund(S.CAPTURED, 10_000n, 0n, 2_500n)).toBe(
      S.PARTIALLY_REFUNDED,
    );
  });

  it('second partial refund stays PARTIALLY_REFUNDED', () => {
    expect(
      statusAfterRefund(S.PARTIALLY_REFUNDED, 10_000n, 2_500n, 2_500n),
    ).toBe(S.PARTIALLY_REFUNDED);
  });

  it('refunding the remainder -> REFUNDED', () => {
    expect(
      statusAfterRefund(S.PARTIALLY_REFUNDED, 10_000n, 2_500n, 7_500n),
    ).toBe(S.REFUNDED);
  });

  it('full refund in one go -> REFUNDED', () => {
    expect(statusAfterRefund(S.CAPTURED, 10_000n, 0n, 10_000n)).toBe(
      S.REFUNDED,
    );
  });

  it('rejects over-refunds', () => {
    expect(() => statusAfterRefund(S.CAPTURED, 10_000n, 0n, 10_001n)).toThrow(
      RangeError,
    );
    expect(() =>
      statusAfterRefund(S.PARTIALLY_REFUNDED, 10_000n, 9_000n, 1_001n),
    ).toThrow(RangeError);
  });

  it('rejects zero or negative refunds', () => {
    expect(() => statusAfterRefund(S.CAPTURED, 10_000n, 0n, 0n)).toThrow(
      RangeError,
    );
    expect(() => statusAfterRefund(S.CAPTURED, 10_000n, 0n, -5n)).toThrow(
      RangeError,
    );
  });

  it('rejects refunds on payments that are not captured', () => {
    expect(() => statusAfterRefund(S.AUTHORIZED, 0n, 0n, 100n)).toThrow(
      RangeError,
    );
    expect(() => statusAfterRefund(S.REFUNDED, 10_000n, 10_000n, 1n)).toThrow(
      RangeError,
    );
  });
});
