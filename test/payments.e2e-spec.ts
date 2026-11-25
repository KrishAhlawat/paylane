import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { generateApiKey, generateWebhookSecret, hashApiKey } from '../src/auth/api-key';
import { PrismaService } from '../src/prisma/prisma.service';

// Needs the dev database from `docker compose up -d` with the migration applied.
// A little bank latency widens the race window so duplicates really overlap.
process.env.MOCK_BANK_LATENCY_MS = '50';

interface TestMerchant {
  id: string;
  apiKey: string;
}

describe('POST /payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: TestMerchant;
  let bob: TestMerchant;

  const body = (token = 'tok_approve', amount = 10_000) => ({
    amount,
    payment_method_token: token,
  });

  const post = (m: TestMerchant, key: string | null, payload: unknown) => {
    const req = request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${m.apiKey}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(payload as object);
  };

  const createMerchant = async (label: string): Promise<TestMerchant> => {
    const apiKey = generateApiKey();
    const merchant = await prisma.merchant.create({
      data: {
        name: `e2e-${label}-${randomUUID()}`,
        apiKeyHash: hashApiKey(apiKey),
        webhookSecret: generateWebhookSecret(),
      },
    });
    return { id: merchant.id, apiKey };
  };

  const countPayments = (m: TestMerchant) => prisma.payment.count({ where: { merchantId: m.id } });

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0); // one shared ephemeral port instead of a new server per request
    prisma = app.get(PrismaService);
    alice = await createMerchant('alice');
    bob = await createMerchant('bob');
  });

  afterAll(async () => {
    const merchantIds = [alice.id, bob.id];
    await prisma.idempotencyKey.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.payment.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    await app.close();
  });

  describe('auth and validation', () => {
    it('401 without an API key', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', randomUUID())
        .send(body())
        .expect(401);
    });

    it('401 with an unknown API key', async () => {
      await post({ id: 'x', apiKey: generateApiKey() }, randomUUID(), body()).expect(401);
    });

    it('400 without an Idempotency-Key', async () => {
      await post(alice, null, body()).expect(400);
    });

    it('400 for an invalid body, and the key is not consumed', async () => {
      const key = randomUUID();
      await post(alice, key, { amount: 99.5, payment_method_token: 'tok_approve' }).expect(400);
      // Same key is still usable with a valid body
      await post(alice, key, body()).expect(201);
    });

    it('400 when someone tries to send a raw card number', async () => {
      await post(alice, randomUUID(), {
        amount: 10_000,
        payment_method_token: '4242424242424242',
      }).expect(400);
    });
  });

  describe('bank outcomes', () => {
    it('201 AUTHORIZED when the bank approves', async () => {
      const res = await post(alice, randomUUID(), body('tok_approve')).expect(201);
      expect(res.body).toMatchObject({
        object: 'payment',
        status: 'AUTHORIZED',
        amount: 10_000,
        currency: 'INR',
        failure_reason: null,
      });
    });

    it('402 FAILED when the bank declines', async () => {
      const res = await post(alice, randomUUID(), body('tok_decline')).expect(402);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'insufficient_funds' });
    });

    it('504 FAILED when the bank times out', async () => {
      const res = await post(alice, randomUUID(), body('tok_timeout')).expect(504);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'bank_timeout' });
    });
  });

  describe('idempotency', () => {
    it('replays the same response for the same key and body, creating one payment', async () => {
      const before = await countPayments(alice);
      const key = randomUUID();

      const first = await post(alice, key, body()).expect(201);
      const second = await post(alice, key, body()).expect(201);

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(await countPayments(alice)).toBe(before + 1);
    });

    it('replays a failed result too (same key never retries the bank)', async () => {
      const key = randomUUID();
      const first = await post(alice, key, body('tok_decline')).expect(402);
      const second = await post(alice, key, body('tok_decline')).expect(402);
      expect(second.body.id).toBe(first.body.id);
    });

    it('422 when the same key is reused with a different body', async () => {
      const key = randomUUID();
      await post(alice, key, body('tok_approve', 10_000)).expect(201);
      await post(alice, key, body('tok_approve', 20_000)).expect(422);
    });

    it('keys are scoped per merchant', async () => {
      const key = randomUUID();
      const a = await post(alice, key, body()).expect(201);
      const b = await post(bob, key, body()).expect(201);
      expect(a.body.id).not.toBe(b.body.id);
    });

    it('25 simultaneous requests with one key create exactly ONE payment', async () => {
      const before = await countPayments(alice);
      const key = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 25 }, () => post(alice, key, body())),
      );

      const statuses = responses.map((r) => r.status);
      // Winner and any replays after it completes are 201; requests that land while
      // the original is still talking to the bank get 409. Nothing else is acceptable.
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      expect(statuses).toContain(201);

      const ids = new Set(responses.filter((r) => r.status === 201).map((r) => r.body.id));
      expect(ids.size).toBe(1);
      expect(await countPayments(alice)).toBe(before + 1);

      // After the dust settles, the same key replays the stored result
      const after = await post(alice, key, body()).expect(201);
      expect(after.body.id).toBe([...ids][0]);
      expect(after.headers['idempotent-replayed']).toBe('true');
    });
  });

  describe('GET /payments/:id', () => {
    it('returns the merchant’s own payment', async () => {
      const created = await post(alice, randomUUID(), body()).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${alice.apiKey}`)
        .expect(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it('404 for another merchant’s payment', async () => {
      const created = await post(alice, randomUUID(), body()).expect(201);
      await request(app.getHttpServer())
        .get(`/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${bob.apiKey}`)
        .expect(404);
    });

    it('404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get(`/payments/${randomUUID()}`)
        .set('Authorization', `Bearer ${alice.apiKey}`)
        .expect(404);
    });
  });
});
