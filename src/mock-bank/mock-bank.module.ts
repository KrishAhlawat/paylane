import { Module } from '@nestjs/common';
import { MockBankService } from './mock-bank.service';

@Module({
  providers: [{ provide: MockBankService, useFactory: () => new MockBankService() }],
  exports: [MockBankService],
})
export class MockBankModule {}
