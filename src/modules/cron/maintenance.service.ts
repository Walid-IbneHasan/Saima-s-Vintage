import { Injectable, Logger } from '@nestjs/common';
import { CartStatus, OrderStatus, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Expire unpaid orders whose reservations have passed their TTL: restock and
   * mark EXPIRED. Idempotent (releaseReservations only touches ACTIVE rows).
   */
  async expireUnpaidOrders(): Promise<number> {
    const now = new Date();
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.AWAITING_PAYMENT,
        reservations: {
          some: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now } },
        },
      },
      select: { id: true },
      take: 200,
    });

    let count = 0;
    for (const order of orders) {
      await this.inventory.releaseReservations(order.id, 'expiry');
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.EXPIRED },
      });
      count += 1;
    }
    if (count) this.logger.log(`Expired ${count} unpaid order(s)`);
    return count;
  }

  /** Flag variants at/under their low-stock threshold and enqueue an alert. */
  async scanLowStock(): Promise<number> {
    const variants = await this.prisma.$queryRaw<
      { id: string; stock: number; lowStockThreshold: number }[]
    >`
      SELECT v.id, v.stock, v.lowStockThreshold
      FROM ProductVariant v
      WHERE v.isActive = true AND v.stock <= v.lowStockThreshold
        AND NOT EXISTS (
          SELECT 1 FROM LowStockNotification n
          WHERE n.variantId = v.id AND n.resolvedAt IS NULL
        )
      LIMIT 200
    `;

    for (const v of variants) {
      await this.prisma.lowStockNotification.create({
        data: {
          variantId: v.id,
          threshold: v.lowStockThreshold,
          stockAtTrigger: v.stock,
        },
      });
      await this.jobs.enqueue('email.low_stock', {
        variantId: v.id,
        html: `Variant ${v.id} is low on stock (${v.stock} left, threshold ${v.lowStockThreshold}).`,
      });
    }
    return variants.length;
  }

  /** Mark stale active carts abandoned (cleanup; reservations are separate). */
  async cleanCarts(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const res = await this.prisma.cart.updateMany({
      where: { status: CartStatus.ACTIVE, updatedAt: { lt: cutoff } },
      data: { status: CartStatus.ABANDONED },
    });
    return res.count;
  }
}
