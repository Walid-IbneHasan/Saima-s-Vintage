import { Module } from '@nestjs/common';
import { BkashController } from './bkash.controller';
import { BkashService } from './bkash.service';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [BkashController],
  providers: [BkashService, PaymentsService],
  exports: [PaymentsService, BkashService],
})
export class PaymentsModule {}
