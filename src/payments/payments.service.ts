import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Merchant, Prisma } from '@prisma/client';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BankOutcome, MockBankService } from '../mock-bank/mock-bank.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentInput } from './create-payment.schema';
import { PaymentStatus, assertTransition } from './payment-state-machine';
import { PublicPayment, toPublicPayment } from './payment.serializer';

export interface CreatePaymentCommand {
  merchant: Merchant;
  idempotencyKey: string;
  requestHash: string;
  input: CreatePaymentInput;
}

export interface PaymentResponse {
  status: number;
  body: unknown;
  /** True when this response was replayed from a previous request with the same key. */
  replayed: boolean;
}

/** HTTP status stored for each bank outcome. Replays return the same status. */
const HTTP_STATUS_BY_OUTCOME: Record<BankOutcome, number> = {
  APPROVED: 201,
  DECLINED: 402,
  TIMEOUT: 504,
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly bank: MockBankService,
  ) {}

  /**
   * Three phases, so a slow bank call never holds a DB transaction open:
   *
   *  1. TX: claim the idempotency key and insert the payment as CREATED (atomic).
   *  2. Call the (mock) bank, outside any transaction.
   *  3. TX: move CREATED -> AUTHORIZED/FAILED with a compare-and-swap on status,
   *         and store the response against the key.
   *
   * If the process dies between phases 1 and 3, the payment stays CREATED and the key
   * stays locked (retries get 409). A recovery/reconciliation job (week 3) resolves those.
   */
  async create(cmd: CreatePaymentCommand): Promise<PaymentResponse> {
    const { merchant, idempotencyKey: key, requestHash, input } = cmd;

    // Phase 1
    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await this.idempotency.claim(tx, {
        merchantId: merchant.id,
        key,
        requestHash,
      });
      if (!claimed) return null;

      const payment = await tx.payment.create({
        data: {
          merchantId: merchant.id,
          amount: BigInt(input.amount),
          currency: input.currency,
          status: PaymentStatus.CREATED,
          metadata: input.metadata ?? undefined,
        },
      });
      await this.idempotency.attachPayment(tx, {
        merchantId: merchant.id,
        key,
        paymentId: payment.id,
      });
      return payment;
    });

    if (!created) {
      const stored = await this.idempotency.resolveExisting({
        merchantId: merchant.id,
        key,
        requestHash,
      });
      return { ...stored, replayed: true };
    }

    try {
      // Phase 2
      const bankResult = await this.bank.authorize({
        amount: created.amount,
        currency: created.currency,
        token: input.payment_method_token,
      });

      const next =
        bankResult.outcome === 'APPROVED' ? PaymentStatus.AUTHORIZED : PaymentStatus.FAILED;
      assertTransition(PaymentStatus.CREATED, next);
      const httpStatus = HTTP_STATUS_BY_OUTCOME[bankResult.outcome];

      // Phase 3
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const moved = await tx.payment.updateMany({
          where: { id: created.id, status: PaymentStatus.CREATED },
          data: {
            status: next,
            bankReference: bankResult.reference ?? null,
            failureReason: bankResult.reason ?? null,
          },
        });
        if (moved.count !== 1) {
          throw new ConflictException('Payment state changed concurrently');
        }

        const payment = await tx.payment.findUniqueOrThrow({ where: { id: created.id } });
        const body = toPublicPayment(payment);
        await this.idempotency.complete(tx, {
          merchantId: merchant.id,
          key,
          response: { status: httpStatus, body },
        });
        return { status: httpStatus, body, replayed: false };
      });
    } catch (err) {
      this.logger.error(
        `Payment ${created.id} left in CREATED with idempotency key "${key}" locked: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  async get(merchantId: string, id: string): Promise<PublicPayment> {
    const payment = await this.prisma.payment.findFirst({ where: { id, merchantId } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return toPublicPayment(payment);
  }
}
