import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SalesSummary {
  revenue: number;
  paidOrders: number;
  pendingReview: number;
  awaitingPayment: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
}

// Statuses that count as a realised sale.
const SOLD = "('PAID','PROCESSING','SHIPPED','DELIVERED')";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sales aggregates computed in SQL — never by looping rows in JS. */
  async summary(): Promise<SalesSummary> {
    const [totals] = await this.prisma.$queryRawUnsafe<
      { revenue: string | null; orders: bigint }[]
    >(
      `SELECT COALESCE(SUM(grandTotal),0) AS revenue, COUNT(*) AS orders
       FROM \`Order\` WHERE status IN ${SOLD}`,
    );

    const topProducts = await this.prisma.$queryRawUnsafe<
      { name: string; quantity: bigint; revenue: string }[]
    >(
      `SELECT oi.productName AS name, SUM(oi.quantity) AS quantity, SUM(oi.lineTotal) AS revenue
       FROM OrderItem oi JOIN \`Order\` o ON o.id = oi.orderId
       WHERE o.status IN ${SOLD}
       GROUP BY oi.productName ORDER BY quantity DESC LIMIT 10`,
    );

    const [pendingReview, awaitingPayment] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PAYMENT_REVIEW' } }),
      this.prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
    ]);

    return {
      revenue: Number(totals?.revenue ?? 0),
      paidOrders: Number(totals?.orders ?? 0),
      pendingReview,
      awaitingPayment,
      topProducts: topProducts.map((t) => ({
        name: t.name,
        quantity: Number(t.quantity),
        revenue: Number(t.revenue),
      })),
    };
  }
}
