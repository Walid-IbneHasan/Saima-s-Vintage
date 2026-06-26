import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Database-backed job queue. No long-running worker exists on cPanel shared
 * hosting, so jobs are drained by a cron-triggered endpoint (drain()). Claiming
 * is atomic (conditional updateMany), so concurrent drains never double-run a job.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    runAt?: Date,
  ): Promise<string> {
    const job = await this.prisma.job.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        status: JobStatus.PENDING,
        runAt: runAt ?? new Date(),
      },
    });
    return job.id;
  }

  async drain(limit = 20): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.claimNext();
      if (!job) break;
      try {
        await this.handle(job);
        await this.prisma.job.update({
          where: { id: job.id },
          data: { status: JobStatus.DONE, lockedAt: null, lockedBy: null },
        });
        processed += 1;
      } catch (e) {
        failed += 1;
        const attempts = job.attempts + 1;
        const exhausted = attempts >= job.maxAttempts;
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
            attempts,
            lastError: String((e as Error)?.message ?? e).slice(0, 1000),
            // exponential-ish backoff for retries
            runAt: exhausted
              ? job.runAt
              : new Date(Date.now() + attempts * 60_000),
            lockedAt: null,
            lockedBy: null,
          },
        });
        this.logger.warn(`Job ${job.id} (${job.type}) failed attempt ${attempts}`);
      }
    }
    return { processed, failed };
  }

  private async claimNext(): Promise<Job | null> {
    const candidate = await this.prisma.job.findFirst({
      where: { status: JobStatus.PENDING, runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return null;

    const lockedBy = `${process.pid}:${Date.now()}`;
    const claimed = await this.prisma.job.updateMany({
      where: { id: candidate.id, status: JobStatus.PENDING },
      data: { status: JobStatus.PROCESSING, lockedAt: new Date(), lockedBy },
    });
    if (claimed.count === 0) return null; // lost the race to another drainer
    return this.prisma.job.findUnique({ where: { id: candidate.id } });
  }

  private async handle(job: Job): Promise<void> {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    switch (job.type) {
      case 'email.order_confirmation':
        return this.sendOrderConfirmation(String(payload.orderId));
      case 'email.generic':
        return this.notifications.send(
          String(payload.to),
          String(payload.subject),
          String(payload.html),
        );
      case 'email.low_stock':
        return this.notifications.send(
          String(payload.to ?? process.env.SMTP_FROM ?? 'admin@saimasvintage.local'),
          'Low stock alert',
          String(payload.html ?? 'A product variant is low on stock.'),
        );
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async sendOrderConfirmation(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) return;
    const rows = order.items
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.productName)} (${escapeHtml(i.variantName)}) × ${i.quantity}</td><td style="text-align:right">৳${i.lineTotal}</td></tr>`,
      )
      .join('');
    const isCod = order.payments.some((p) => p.provider === 'cod');
    const intro = isCod
      ? `<p>We've received your order and are preparing it. Please keep <strong>৳${order.grandTotal}</strong> ready to pay in cash when it's delivered.</p>`
      : `<p>We've received your payment and are preparing your order.</p>`;
    const html = `
      <h2>Thank you for your order ${order.orderNumber}</h2>
      ${intro}
      <table cellpadding="6">${rows}</table>
      <p><strong>Total: ৳${order.grandTotal}</strong></p>`;
    await this.notifications.send(
      order.email,
      `Order ${order.orderNumber} confirmed`,
      html,
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
