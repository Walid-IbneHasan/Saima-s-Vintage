import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CronGuard } from '../../common/guards/cron.guard';
import { JobsService } from '../jobs/jobs.service';
import { MaintenanceService } from './maintenance.service';

// Triggered by cPanel cron with `X-Cron-Token: $CRON_TOKEN`. All idempotent.
@Controller('internal/cron')
@UseGuards(CronGuard)
@SkipThrottle()
export class CronController {
  constructor(
    private readonly jobs: JobsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  @Post('run-jobs')
  @HttpCode(200)
  runJobs(@Query('limit') limit?: string): Promise<{ processed: number; failed: number }> {
    return this.jobs.drain(Number(limit) || 20);
  }

  @Post('expire-orders')
  @HttpCode(200)
  async expireOrders(): Promise<{ expired: number }> {
    return { expired: await this.maintenance.expireUnpaidOrders() };
  }

  @Post('low-stock-scan')
  @HttpCode(200)
  async lowStockScan(): Promise<{ flagged: number }> {
    return { flagged: await this.maintenance.scanLowStock() };
  }

  @Post('clean-carts')
  @HttpCode(200)
  async cleanCarts(): Promise<{ abandoned: number }> {
    return { abandoned: await this.maintenance.cleanCarts() };
  }
}
