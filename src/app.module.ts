import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'paylane' };
  }
}

// Feature modules (payments, ledger, webhooks, mock-bank) get registered here as they are built.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
