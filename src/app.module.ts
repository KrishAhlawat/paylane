import { Controller, Get, Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'paylane' };
  }
}

// Ledger, webhooks and reconciliation modules get registered here as they are built.
@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [HealthController],
})
export class AppModule {}
