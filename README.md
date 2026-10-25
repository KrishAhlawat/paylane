# Paylane

A payment processing service that handles the full life of a payment (authorize, capture, refund) with **no double-charges on retries** and a **double-entry ledger that always balances**. Built against a mock bank, so no real money or card data is ever involved.

> Learning/portfolio project. Not a licensed payment aggregator. Never send real card numbers to it.

## Why this exists

Real gateways (Razorpay, Stripe) hide the hard parts: idempotency, ledger correctness, webhook reliability, reconciliation. Paylane implements those parts from scratch and proves them with tests.

## Scope

**In (MVP)**
- Payment state machine: `CREATED -> AUTHORIZED -> CAPTURED -> (PARTIALLY_)REFUNDED`, plus `VOIDED` and `FAILED`
- Idempotency keys on every write endpoint
- Double-entry ledger (integer minor units, no floats)
- Signed webhooks (HMAC-SHA256) with exponential backoff and a dead-letter state
- Mock bank that approves, declines, or times out on a configurable ratio
- Reconciliation job: ledger vs. mock bank records

**Out (do not build until MVP is done)**
UPI, multi-currency, fraud detection, real card handling, settlement payouts.

## Stack

NestJS, TypeScript, PostgreSQL (Prisma), Redis, Jest.

## Quick start

```bash
cp .env.example .env
docker compose up -d          # Postgres + Redis
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev             # GET http://localhost:3000/health
npm test
```

## API sketch (planned)

| Method | Path | Notes |
|---|---|---|
| POST | `/payments` | Requires `Idempotency-Key` header. Creates and authorizes via mock bank. |
| POST | `/payments/:id/capture` | Full or partial capture. |
| POST | `/payments/:id/void` | Only from `AUTHORIZED`. |
| POST | `/payments/:id/refunds` | Partial or full. Cannot exceed captured amount. |
| GET | `/payments/:id` | Current state and ledger entries. |
| GET | `/health` | Liveness. |

Webhook events: `payment.authorized`, `payment.captured`, `payment.refunded`, `payment.failed`.
Signature header: `Paylane-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`.

## Design decisions

- **Money is `BigInt` minor units.** Floats lose paise.
- **State machine is pure** (`src/payments/payment-state-machine.ts`). Every legal and illegal transition is unit-tested before any database code exists.
- **Idempotency:** unique `(merchantId, key)` row. Same key and same body returns the stored response. Same key with a different body returns 422. A concurrent duplicate waits on the row lock rather than creating a second payment.
- **Ledger invariant:** for every `transactionId`, sum of debits equals sum of credits. Enforced in code and covered by a property-style test.
- **Concurrency:** payment rows are updated inside a transaction with `SELECT ... FOR UPDATE` so two captures or refunds cannot race.

## Build plan

| Week | Goal | Done when |
|---|---|---|
| 1 | State machine, schema, `POST /payments` with idempotency, mock bank, deployed | Duplicate requests create one payment; app is live on a public URL |
| 2 | Capture, void, refunds, double-entry ledger | Ledger balances after any sequence of operations |
| 3 | Signed webhooks, retries, dead-letter, reconciliation job | Webhooks survive a flapping merchant endpoint |
| 4 | Load test, failure injection, README numbers, architecture diagram | Resume numbers measured, not guessed |

## Numbers to measure (fill in, don't invent)

- Concurrent payments handled in a retry-storm test: `___`
- Double-charges under retries and bank timeouts: `___` (target 0)
- Ledger reconciliation mismatches after load test: `___` (target 0)
- p95 latency of `POST /payments`: `___ ms`

## Status

- [x] Repo scaffold, Docker Compose, Prisma schema
- [x] Payment state machine with 14 passing unit tests
- [ ] Prisma client generated and first migration run (run locally: `npx prisma generate && npx prisma migrate dev --name init`)
- [ ] `POST /payments` with idempotency
- [ ] Mock bank
- [ ] Ledger
- [ ] Webhooks
- [ ] Reconciliation
- [ ] Load test and numbers
