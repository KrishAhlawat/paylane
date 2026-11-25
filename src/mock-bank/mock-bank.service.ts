import { randomUUID } from 'crypto';

export type BankOutcome = 'APPROVED' | 'DECLINED' | 'TIMEOUT';

export interface BankAuthRequest {
  amount: bigint;
  currency: string;
  token: string;
}

export interface BankAuthResult {
  outcome: BankOutcome;
  /** Bank-side reference, present when the bank approved. */
  reference?: string;
  reason?: string;
}

export interface MockBankOptions {
  approveRate: number;
  declineRate: number;
  timeoutRate: number;
  /** Simulated network latency per call. */
  latencyMs: number;
  /** Injected so tests can control randomness. */
  rng: () => number;
}

function readNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`${name} must be a number, got "${value}"`);
  }
  return n;
}

export function mockBankOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): MockBankOptions {
  return {
    approveRate: readNumber(env.MOCK_BANK_APPROVE_RATE, 0.8, 'MOCK_BANK_APPROVE_RATE'),
    declineRate: readNumber(env.MOCK_BANK_DECLINE_RATE, 0.1, 'MOCK_BANK_DECLINE_RATE'),
    timeoutRate: readNumber(env.MOCK_BANK_TIMEOUT_RATE, 0.1, 'MOCK_BANK_TIMEOUT_RATE'),
    latencyMs: readNumber(env.MOCK_BANK_LATENCY_MS, 20, 'MOCK_BANK_LATENCY_MS'),
    rng: Math.random,
  };
}

/**
 * Stand-in for a card network / acquiring bank. Never receives real card data:
 * callers pass an opaque test token.
 *
 * Deterministic tokens (like Stripe's test cards) make demos and tests repeatable:
 *   tok_approve  -> always approved
 *   tok_decline  -> always declined (insufficient_funds)
 *   tok_timeout  -> always times out
 * Any other token is decided randomly using the configured rates.
 */
export class MockBankService {
  private readonly options: MockBankOptions;

  constructor(options: Partial<MockBankOptions> = {}) {
    this.options = { ...mockBankOptionsFromEnv(), ...options };

    const { approveRate, declineRate, timeoutRate, latencyMs } = this.options;
    for (const [name, rate] of Object.entries({ approveRate, declineRate, timeoutRate })) {
      if (!(rate >= 0 && rate <= 1)) {
        throw new Error(`Mock bank ${name} must be between 0 and 1, got ${rate}`);
      }
    }
    const sum = approveRate + declineRate + timeoutRate;
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`Mock bank rates must sum to 1, got ${sum}`);
    }
    if (!(latencyMs >= 0)) {
      throw new Error(`Mock bank latencyMs must be >= 0, got ${latencyMs}`);
    }
  }

  async authorize(req: BankAuthRequest): Promise<BankAuthResult> {
    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }

    switch (req.token) {
      case 'tok_approve':
        return this.approved();
      case 'tok_decline':
        return this.declined();
      case 'tok_timeout':
        return this.timedOut();
    }

    const roll = this.options.rng();
    if (roll < this.options.approveRate) return this.approved();
    if (roll < this.options.approveRate + this.options.declineRate) return this.declined();
    return this.timedOut();
  }

  private approved(): BankAuthResult {
    return { outcome: 'APPROVED', reference: `bank_${randomUUID()}` };
  }

  private declined(): BankAuthResult {
    return { outcome: 'DECLINED', reason: 'insufficient_funds' };
  }

  private timedOut(): BankAuthResult {
    return { outcome: 'TIMEOUT', reason: 'bank_timeout' };
  }
}
