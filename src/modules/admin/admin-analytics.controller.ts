import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AnalyticsService } from '../analytics/analytics.service';

@Controller('admin/analytics')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async view(@Res() res: Response): Promise<void> {
    res.render('admin/analytics', {
      title: 'Analytics',
      stats: await this.analytics.summary(),
    });
  }
}
