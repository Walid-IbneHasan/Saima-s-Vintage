import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { SslcommerzController } from './sslcommerz.controller';
import { SslcommerzService } from './sslcommerz.service';

@Module({
  controllers: [SslcommerzController],
  providers: [SslcommerzService, PaymentsService],
  exports: [PaymentsService, SslcommerzService],
})
export class PaymentsModule {}
