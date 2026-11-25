import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiKeyGuard, AuthedRequest } from '../auth/api-key.guard';
import { hashRequest } from '../idempotency/request-hash';
import { createPaymentSchema } from './create-payment.schema';
import { PaymentsService } from './payments.service';

/** Printable ASCII without spaces, 1-255 chars (UUIDs and similar work well). */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

@Controller('payments')
@UseGuards(ApiKeyGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key header is required (1-255 printable characters, no spaces)',
      );
    }

    // Validate before touching the database so malformed requests never consume a key.
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const result = await this.payments.create({
      merchant: req.merchant,
      idempotencyKey,
      requestHash: hashRequest('POST', '/payments', parsed.data),
      input: parsed.data,
    });

    res.status(result.status);
    if (result.replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return result.body;
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.payments.get(req.merchant.id, id);
  }
}
