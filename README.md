# Paylane

A payment processing service that handles the full life of a payment (authorize, capture, refund) with **no double-charges on retries** and a **double-entry ledger that always balances**. Built against a mock bank, so no real money or card data is ever involved.

> Learning/portfolio project. Not a licensed payment aggregator. Never send real card numbers to it (the API rejects anything that is not a `tok_...` test token).

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
docker compose up -d          # Postgres (host port 54329) + Redis
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run merchant:create -- "My Shop"   # prints an API key once
npm run start:dev             # GET http://localhost:3000/health
```

Postgres is published on host port **54329**, not 5432, so it cannot collide with a Postgres already installed on your machine.

## Tests

```bash
npm test            # unit + in-memory HTTP tests, no Docker needed
npm run test:e2e    # against the real database (docker compose up -d first)
```

## API

All endpoints need `Authorization: Bearer pl_test_...`. Money is an integer in paise: `10000` = Rs 100.00.

| Method | Path | Status |
|---|---|---|
| POST | `/payments` | Done. Requires `Idempotency-Key`. Creates and authorizes via the mock bank. |
| GET | `/payments/:id` | Done. Scoped to the calling merchant. |
| POST | `/payments/:id/capture` | Week 2 |
| POST | `/payments/:id/void` | Week 2 |
| POST | `/payments/:id/refunds` | Week 2 |
| GET | `/health` | Done. No auth. |

### Create a payment (PowerShell)

```powershell
$key  = "pl_test_..."                       # from npm run merchant:create
$idem = [guid]::NewGuid().ToString()

Invoke-RestMethod -Method Post -Uri http://localhost:3000/payments `
  -Headers @{ Authorization = "Bearer $key"; "Idempotency-Key" = $idem } `
  -ContentType "application/json" `
  -Body '{"amount":10000,"payment_method_token":"tok_approve"}'
```

Run it twice with the same `$idem` and you get the same payment back (response header `Idempotent-Replayed: true`) instead of a second charge.

### Mock bank test tokens

| Token | Bank result | HTTP | Payment status |
|---|---|---|---|
| `tok_approve` | approved | 201 | `AUTHORIZED` |
| `tok_decline` | declined (`insufficient_funds`) | 402 | `FAILED` |
| `tok_timeout` | timed out (`bank_timeout`) | 504 | `FAILED` |
| anything else, e.g. `tok_visa_1` | random, by `MOCK_BANK_*_RATE` | varies | varies |

Errors: `400` bad body or missing `Idempotency-Key`, `401` bad API key, `404` unknown payment, `409` same key still being processed, `422` same key reused with a different body.

Planned webhook events: `payment.authorized`, `payment.captured`, `payment.refunded`, `payment.failed`.
Signature header: `Paylane-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`.

## Design decisions

- **Money is `BigInt` minor units** in the database; the API exposes integers. Floats lose paise.
- **State machine is pure** (`src/payments/payment-state-machine.ts`). Every legal and illegal transition is unit-tested before any database code touches it.
- **Idempotency** (`src/idempotency/`): a unique `(merchantId, key)` row is claimed with `INSERT ... ON CONFLICT DO NOTHING`, inside the same transaction that creates the payment. Exactly one concurrent request wins the claim. The rest either replay the stored response, get `409` while the original is still running, or get `422` if the body differs. A request body is fingerprinted with a canonical JSON hash, so key order does not matter.
- **Three-phase create:** (1) one transaction claims the key and inserts the payment as `CREATED`; (2) the bank is called with no transaction held open; (3) one transaction moves `CREATED -> AUTHORIZED/FAILED` with a compare-and-swap on status and stores the response. Failed bank outcomes are stored and replayed too, so retrying with the same key never re-hits the bank. To retry a declined payment, use a new key.
- **Known gap:** if the process dies between phases 1 and 3, the payment stays `CREATED` and its key stays locked (retries get `409`, never a duplicate). The reconciliation/recovery job in week 3 resolves these.
- **Ledger invariant (week 2):** for every `transactionId`, sum of debits equals sum of credits, enforced in code and tested.
- **Concurrency (week 2):** capture and refund will lock the payment row (`SELECT ... FOR UPDATE`) so they cannot race.

## Build plan

| Week | Goal | Done when |
|---|---|---|
| 1 | State machine, schema, `POST /payments` with idempotency, mock bank, deployed | Duplicate requests create one payment; app is live on a public URL |
| 2 | Capture, void, refunds, double-entry ledger | Ledger balances after any sequence of operations |
| 3 | Signed webhooks, retries, dead-letter, reconciliation and recovery job | Webhooks survive a flapping merchant endpoint |
| 4 | Load test, failure injection, README numbers, architecture diagram | Resume numbers measured, not guessed |

## Numbers to measure (fill in, don't invent)

- Concurrent payments handled in a retry-storm test: `___`
- Double-charges under retries and bank timeouts: `___` (target 0)
- Ledger reconciliation mismatches after load test: `___` (target 0)
- p95 latency of `POST /payments`: `___ ms`

## Status

- [x] Repo scaffold, Docker Compose, Prisma schema, first migration
- [x] Payment state machine
- [x] Mock bank with deterministic test tokens
- [x] API-key auth and merchant creation script
- [x] `POST /payments` and `GET /payments/:id` with idempotency
- [x] Unit tests, in-memory HTTP tests, and a real-database e2e suite (including 25 simultaneous duplicate requests)
- [ ] Deploy to a public URL (finish week 1)
- [ ] Capture, void, refunds
- [ ] Ledger
- [ ] Webhooks
- [ ] Reconciliation and recovery job
- [ ] Load test and numbers
