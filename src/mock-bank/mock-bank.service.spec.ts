import { MockBankService, mockBankOptionsFromEnv } from './mock-bank.service';

const base = { approveRate: 0.8, declineRate: 0.1, timeoutRate: 0.1, latencyMs: 0 };
const req = (token: string) => ({ amount: 10_000n, currency: 'INR', token });

describe('MockBankService', () => {
  describe('deterministic tokens', () => {
    // rng returns a value that would land on TIMEOUT, proving tokens override it
    const bank = new MockBankService({ ...base, rng: () => 0.99 });

    it('tok_approve is always approved with a bank reference', async () => {
      const res = await bank.authorize(req('tok_approve'));
      expect(res.outcome).toBe('APPROVED');
      expect(res.reference).toMatch(/^bank_/);
    });

    it('tok_decline is always declined', async () => {
      const res = await bank.authorize(req('tok_decline'));
      expect(res).toEqual({ outcome: 'DECLINED', reason: 'insufficient_funds' });
    });

    it('tok_timeout always times out', async () => {
      const res = await bank.authorize(req('tok_timeout'));
      expect(res).toEqual({ outcome: 'TIMEOUT', reason: 'bank_timeout' });
    });

    it('issues a unique reference per approval', async () => {
      const a = await bank.authorize(req('tok_approve'));
      const b = await bank.authorize(req('tok_approve'));
      expect(a.reference).not.toBe(b.reference);
    });
  });

  describe('random tokens use the configured rates', () => {
    const outcomeFor = async (roll: number) =>
      (await new MockBankService({ ...base, rng: () => roll }).authorize(req('tok_visa_1'))).outcome;

    it('maps rng ranges to approve / decline / timeout', async () => {
      expect(await outcomeFor(0)).toBe('APPROVED');
      expect(await outcomeFor(0.79)).toBe('APPROVED');
      expect(await outcomeFor(0.8)).toBe('DECLINED');
      expect(await outcomeFor(0.89)).toBe('DECLINED');
      expect(await outcomeFor(0.9)).toBe('TIMEOUT');
      expect(await outcomeFor(0.999)).toBe('TIMEOUT');
    });

    it('a 100% approve rate never declines or times out', async () => {
      const bank = new MockBankService({
        approveRate: 1,
        declineRate: 0,
        timeoutRate: 0,
        latencyMs: 0,
        rng: () => 0.999999,
      });
      expect((await bank.authorize(req('tok_any'))).outcome).toBe('APPROVED');
    });
  });

  describe('configuration', () => {
    it('rejects rates that do not sum to 1', () => {
      expect(() => new MockBankService({ ...base, approveRate: 0.5 })).toThrow(/sum to 1/);
    });

    it('rejects rates outside 0..1', () => {
      expect(
        () => new MockBankService({ ...base, approveRate: 1.2, declineRate: -0.2 }),
      ).toThrow(/between 0 and 1/);
    });

    it('rejects negative latency', () => {
      expect(() => new MockBankService({ ...base, latencyMs: -1 })).toThrow(/latencyMs/);
    });

    it('reads options from env with defaults', () => {
      expect(mockBankOptionsFromEnv({})).toMatchObject({
        approveRate: 0.8,
        declineRate: 0.1,
        timeoutRate: 0.1,
        latencyMs: 20,
      });
      expect(
        mockBankOptionsFromEnv({
          MOCK_BANK_APPROVE_RATE: '0.5',
          MOCK_BANK_DECLINE_RATE: '0.25',
          MOCK_BANK_TIMEOUT_RATE: '0.25',
          MOCK_BANK_LATENCY_MS: '0',
        }),
      ).toMatchObject({ approveRate: 0.5, declineRate: 0.25, timeoutRate: 0.25, latencyMs: 0 });
    });

    it('throws on a non-numeric env value', () => {
      expect(() => mockBankOptionsFromEnv({ MOCK_BANK_APPROVE_RATE: 'abc' })).toThrow(
        /MOCK_BANK_APPROVE_RATE/,
      );
    });
  });
});
