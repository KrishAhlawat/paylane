import { Module } from '@nestjs/common';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { MockBankModule } from '../mock-bank/mock-bank.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [MockBankModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, IdempotencyService],
})
export class PaymentsModule {}
