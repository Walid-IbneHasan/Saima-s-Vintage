import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AnalyticsService } from '../analytics/analytics.service';
import { barChart, comboChart, donut } from '../analytics/charts';

// Status → colour for the donut + legend (premium, distinguishable, AA on white).
const STATUS_COLORS: Record<string, string> = {
  PAID: '#3f7d4f',
  PROCESSING: '#a87c32',
  SHIPPED: '#4a7d8c',
  DELIVERED: '#2f6e4a',
  AWAITING_PAYMENT: '#c2912f',
  PAYMENT_REVIEW: '#6f63a6',
  CANCELLED: '#8a7d6c',
  FAILED: '#b0241c',
  EXPIRED: '#9a8e7c',
  REFUNDED: '#6b5d49',
  PARTIALLY_REFUNDED: '#8a6a4a',
};

function hourLabel(h: number): string {
  const ap = h < 12 ? 'a' : 'p';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ap}`;
}

function hour12(h: number): string {
  const ap = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ap}`;
}

/** Compact ৳ for chart axes: ৳1.2k, ৳3.4M. */
function compactBdt(n: number): string {
  if (n >= 1_000_000) return `৳${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `৳${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}k`;
  return `৳${Math.round(n)}`;
}

@Controller('admin/analytics')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async view(@Query('range') range: string, @Res() res: Response): Promise<void> {
    const dash = await this.analytics.dashboard(range);

    const trendChart = comboChart(dash.trend);
    // Compact ৳ labels for the y-axis ticks.
    const trendYTicks = trendChart.yTicks.map((t) => ({ ...t, label: compactBdt(t.value) }));
    const peakHourLabel = dash.peakHour
      ? `${hour12(dash.peakHour.hour)}–${hour12((dash.peakHour.hour + 1) % 24)}`
      : null;

    const hourChart = barChart(
      dash.peakHours.map((p) => ({ label: hourLabel(p.hour), value: p.orders })),
      { h: 190, labelEvery: 3 },
    );
    const weekdayChart = barChart(
      dash.weekdays.map((d) => ({ label: d.label, value: d.orders })),
      { h: 190, labelEvery: 1 },
    );

    const legend = dash.statusBreakdown.map((s) => ({
      ...s,
      color: STATUS_COLORS[s.status] ?? '#8a7d6c',
    }));
    const statusDonut = donut(
      legend.map((s) => ({ label: s.label, value: s.count, color: s.color })),
    );

    // Max revenue across top products/categories for horizontal bar widths.
    const maxProductRevenue = Math.max(1, ...dash.topProducts.map((p) => p.revenue));
    const maxCategoryRevenue = Math.max(1, ...dash.topCategories.map((c) => c.revenue));

    res.render('admin/analytics', {
      title: 'Analytics',
      dash,
      trendChart,
      trendYTicks,
      peakHourLabel,
      hourChart,
      weekdayChart,
      statusDonut,
      legend,
      statusColors: STATUS_COLORS,
      maxProductRevenue,
      maxCategoryRevenue,
    });
  }
}
