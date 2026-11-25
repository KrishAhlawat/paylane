import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateApiKey, hashApiKey } from '../auth/api-key';
import { MockBankService } from '../mock-bank/mock-bank.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsModule } from './payments.module';

/**
 * HTTP-level tests against an in-memory stand-in for the database, so they run
 * without Docker. They exercise routing, auth, validation, status codes, headers and
 * the idempotency flow. Real Postgres behaviour (unique constraint, ON CONFLICT,
 * transactions) is covered by test/payments.e2e-spec.ts.
 */
class FakeDb {
  merchants = new Map<string, any>();
  payments: any[] = [];
  keys: any[] = [];

  merchant = {
    findUnique: async ({ where }: any) => this.merchants.get(where.apiKeyHash) ?? null,
  };

  payment = {
    create: async ({ data }: any) => {
      const row = {
        id: randomUUID(),
        capturedAmount: 0n,
        refundedAmount: 0n,
        failureReason: null,
        bankReference: null,
        metadata: null,
        createdAt: new Date(),
        ...data,
      };
      this.payments.push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const row = this.payments.find((p) => p.id === where.id && p.status === where.status);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findUniqueOrThrow: async ({ where }: any) => ({
      ...this.payments.find((p) => p.id === where.id),
    }),
    findFirst: async ({ where }: any) => {
      const row = this.payments.find(
        (p) => p.id === where.id && p.merchantId === where.merchantId,
      );
      return row ? { ...row } : null;
    },
  };

  private findKey = (w: any) =>
    this.keys.find((k) => k.merchantId === w.merchantId_key.merchantId && k.key === w.merchantId_key.key);

  idempotencyKey = {
    // Mirrors INSERT ... ON CONFLICT DO NOTHING: first writer wins, the rest get count 0.
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const d of data) {
        if (!this.keys.some((k) => k.merchantId === d.merchantId && k.key === d.key)) {
          this.keys.push({ responseStatus: null, responseBody: null, paymentId: null, ...d });
          count++;
        }
      }
      return { count };
    },
    update: async ({ where, data }: any) => Object.assign(this.findKey(where), data),
    findUnique: async ({ where }: any) => {
      const row = this.findKey(where);
      return row ? { ...row } : null;
    },
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
}

describe('payments HTTP layer (in-memory DB)', () => {
  let app: INestApplication;
  let db: FakeDb;
  let bank: MockBankService;
  let apiKey: string;
  let otherKey: string;

  const body = (token = 'tok_approve', amount = 10_000) => ({
    amount,
    payment_method_token: token,
  });

  const post = (key: string | null, payload: unknown, auth = apiKey) => {
    const req = request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${auth}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(payload as object);
  };

  const addMerchant = (id: string) => {
    const key = generateApiKey();
    db.merchants.set(hashApiKey(key), { id, name: id, webhookSecret: 'whsec_x' });
    return key;
  };

  beforeEach(async () => {
    db = new FakeDb();
    bank = new MockBankService({
      approveRate: 0.8,
      declineRate: 0.1,
      timeoutRate: 0.1,
      latencyMs: 30, // wide enough for concurrent duplicates to overlap
    });
    apiKey = addMerchant('m_1');
    otherKey = addMerchant('m_2');

    const moduleRef = await Test.createTestingModule({ imports: [PaymentsModule, PrismaModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(MockBankService)
      .useValue(bank)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // one shared ephemeral port instead of a new server per request
  });

  afterEach(async () => {
    await app.close();
  });

  describe('auth and validation', () => {
    it('401 without or with an unknown API key', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', randomUUID())
        .send(body())
        .expect(401);
      await post(randomUUID(), body(), generateApiKey()).expect(401);
    });

    it('400 without an Idempotency-Key, and for keys with spaces', async () => {
      await post(null, body()).expect(400);
      await post('has space', body()).expect(400);
    });

    it('400 for invalid bodies, and the key is not consumed', async () => {
      const key = randomUUID();
      await post(key, { amount: 99.5, payment_method_token: 'tok_approve' }).expect(400);
      await post(key, { amount: 100, payment_method_token: '4242424242424242' }).expect(400);
      expect(db.keys).toHaveLength(0);
      await post(key, body()).expect(201);
    });
  });

  describe('bank outcomes', () => {
    it('201 AUTHORIZED on approval', async () => {
      const res = await post(randomUUID(), body('tok_approve')).expect(201);
      expect(res.body).toMatchObject({
        object: 'payment',
        status: 'AUTHORIZED',
        amount: 10_000,
        currency: 'INR',
        failure_reason: null,
      });
      expect(db.payments[0].bankReference).toMatch(/^bank_/);
    });

    it('402 FAILED on decline', async () => {
      const res = await post(randomUUID(), body('tok_decline')).expect(402);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'insufficient_funds' });
    });

    it('504 FAILED on bank timeout', async () => {
      const res = await post(randomUUID(), body('tok_timeout')).expect(504);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'bank_timeout' });
    });
  });

  describe('idempotency', () => {
    it('replays the stored response and creates one payment', async () => {
      const key = randomUUID();
      const first = await post(key, body()).expect(201);
      const second = await post(key, body()).expect(201);

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(db.payments).toHaveLength(1);
    });

    it('replays failures with the original status instead of retrying the bank', async () => {
      const key = randomUUID();
      const authorize = jest.spyOn(bank, 'authorize');
      await post(key, body('tok_decline')).expect(402);
      await post(key, body('tok_decline')).expect(402);
      expect(authorize).toHaveBeenCalledTimes(1);
    });

    it('treats reordered JSON keys as the same request', async () => {
      const key = randomUUID();
      await post(key, { amount: 10_000, payment_method_token: 'tok_approve' }).expect(201);
      await post(key, { payment_method_token: 'tok_approve', amount: 10_000 }).expect(201);
      expect(db.payments).toHaveLength(1);
    });

    it('422 when the key is reused with a different body', async () => {
      const key = randomUUID();
      await post(key, body('tok_approve', 10_000)).expect(201);
      await post(key, body('tok_approve', 20_000)).expect(422);
      expect(db.payments).toHaveLength(1);
    });

    it('scopes keys per merchant', async () => {
      const key = randomUUID();
      const a = await post(key, body()).expect(201);
      const b = await post(key, body(), otherKey).expect(201);
      expect(a.body.id).not.toBe(b.body.id);
      expect(db.payments).toHaveLength(2);
    });

    it('25 simultaneous requests with one key create exactly one payment and call the bank once', async () => {
      const key = randomUUID();
      const authorize = jest.spyOn(bank, 'authorize');

      const responses = await Promise.all(Array.from({ length: 25 }, () => post(key, body())));

      const statuses = responses.map((r) => r.status);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      expect(statuses).toContain(201);
      expect(statuses).toContain(409); // duplicates really did overlap the original
      expect(new Set(responses.filter((r) => r.status === 201).map((r) => r.body.id)).size).toBe(1);
      expect(db.payments).toHaveLength(1);
      expect(authorize).toHaveBeenCalledTimes(1);
    });

    it('if processing crashes mid-flight the payment stays CREATED and the key stays locked (409)', async () => {
      const key = randomUUID();
      jest.spyOn(bank, 'authorize').mockRejectedValueOnce(new Error('bank client exploded'));

      await post(key, body()).expect(500);
      expect(db.payments).toHaveLength(1);
      expect(db.payments[0].status).toBe('CREATED');

      // Known limitation until the recovery job exists: retries are refused, never duplicated.
      await post(key, body()).expect(409);
      expect(db.payments).toHaveLength(1);
    });
  });

  describe('GET /payments/:id', () => {
    it('returns own payments and 404s for other merchants or unknown ids', async () => {
      const created = await post(randomUUID(), body()).expect(201);

      const own = await request(app.getHttpServer())
        .get(`/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(own.body.id).toBe(created.body.id);

      await request(app.getHttpServer())
        .get(`/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${otherKey}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/payments/${randomUUID()}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(404);
    });
  });
});
