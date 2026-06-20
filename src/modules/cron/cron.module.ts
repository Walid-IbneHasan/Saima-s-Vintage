import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  controllers: [CronController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class CronModule {}
