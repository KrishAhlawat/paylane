import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface StoredResponse {
  status: number;
  body: unknown;
}

interface KeyRef {
  merchantId: string;
  key: string;
}

/**
 * Idempotency for write endpoints, backed by the `IdempotencyKey` table
 * (unique on merchantId + key).
 *
 * Lifecycle of a key:
 *   1. claim()    - inside the caller's DB transaction: INSERT ... ON CONFLICT DO NOTHING.
 *                   Exactly one concurrent caller gets `true`; everyone else gets `false`.
 *   2. complete() - inside the finalizing transaction: stores the response.
 *   3. resolveExisting() - for callers that lost the claim: replay the stored response,
 *                   or fail with 409 (original still running) / 422 (different request).
 *
 * ON CONFLICT DO NOTHING is used instead of catching a unique-violation error because a
 * violation aborts the surrounding Postgres transaction.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    tx: Prisma.TransactionClient,
    p: KeyRef & { requestHash: string },
  ): Promise<boolean> {
    const result = await tx.idempotencyKey.createMany({
      data: [
        {
          merchantId: p.merchantId,
          key: p.key,
          requestHash: p.requestHash,
          lockedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async attachPayment(
    tx: Prisma.TransactionClient,
    p: KeyRef & { paymentId: string },
  ): Promise<void> {
    await tx.idempotencyKey.update({
      where: { merchantId_key: { merchantId: p.merchantId, key: p.key } },
      data: { paymentId: p.paymentId },
    });
  }

  async complete(
    tx: Prisma.TransactionClient,
    p: KeyRef & { response: StoredResponse },
  ): Promise<void> {
    await tx.idempotencyKey.update({
      where: { merchantId_key: { merchantId: p.merchantId, key: p.key } },
      data: {
        responseStatus: p.response.status,
        responseBody: p.response.body as Prisma.InputJsonValue,
        lockedAt: null,
      },
    });
  }

  /** Called when claim() returned false. Replays the stored response or throws. */
  async resolveExisting(p: KeyRef & { requestHash: string }): Promise<StoredResponse> {
    const row = await this.prisma.idempotencyKey.findUnique({
      where: { merchantId_key: { merchantId: p.merchantId, key: p.key } },
    });

    if (!row) {
      // Only possible if the key was removed between our claim attempt and this read.
      throw new ConflictException('Idempotency key state changed, please retry the request');
    }
    if (row.requestHash !== p.requestHash) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different request body',
      );
    }
    if (row.responseStatus === null) {
      throw new ConflictException(
        'A request with this Idempotency-Key is still being processed',
      );
    }
    return { status: row.responseStatus, body: row.responseBody };
  }
}
