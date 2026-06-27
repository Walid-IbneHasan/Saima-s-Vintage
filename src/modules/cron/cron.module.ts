import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CronController } from './cron.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [PaymentsModule],
  controllers: [CronController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class CronModule {}
