import { ConflictException, Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ReserveItem {
  variantId: string;
  quantity: number;
}

/**
 * Authoritative stock logic. The single invariant: physical `ProductVariant.stock`
 * is only ever read/mutated while the row is locked with SELECT … FOR UPDATE,
 * inside a transaction. That makes the "two buyers, last unit" race impossible —
 * the second transaction blocks on the lock, then reads the already-decremented
 * stock and fails.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private get ttlMinutes(): number {
    return Number(process.env.RESERVATION_TTL_MINUTES ?? 30);
  }

  /** Physical on-hand stock (reserved units are already decremented from it). */
  async availableStock(variantId: string): Promise<number> {
    const v = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    return v?.stock ?? 0;
  }

  /**
   * Reserve stock for an order INSIDE the caller's transaction. Locks every
   * involved variant row up front (sorted, to avoid deadlocks), validates each,
   * decrements stock, and writes an ACTIVE reservation + RESERVATION movement.
   * Throws ConflictException if any line can't be satisfied → the caller's
   * transaction rolls back atomically (order + items + reservations all undone).
   */
  async reserveForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: ReserveItem[],
  ): Promise<void> {
    if (items.length === 0) throw new ConflictException('No items to reserve');

    const ids = [...new Set(items.map((i) => i.variantId))].sort();

    // Acquire row locks first. This serializes concurrent checkouts per variant.
    await tx.$queryRaw`SELECT id FROM ProductVariant WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;

    // Consistent read under the locks held above.
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        stock: true,
        isActive: true,
        lowStockThreshold: true,
        product: {
          select: {
            isActive: true,
            allowBackorder: true,
            minPerOrder: true,
            maxPerOrder: true,
          },
        },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);

    for (const item of items) {
      const v = byId.get(item.variantId);
      if (!v || !v.isActive || !v.product.isActive) {
        throw new ConflictException('A product in your cart is no longer available');
      }
      if (item.quantity < v.product.minPerOrder) {
        throw new ConflictException('Below the minimum order quantity');
      }
      if (v.product.maxPerOrder && item.quantity > v.product.maxPerOrder) {
        throw new ConflictException('Exceeds the maximum order quantity');
      }
      if (!v.product.allowBackorder && v.stock < item.quantity) {
        throw new ConflictException('Sorry — that item just sold out');
      }

      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { decrement: item.quantity } },
      });

      const reservation = await tx.inventoryReservation.create({
        data: {
          variantId: item.variantId,
          orderId,
          quantity: item.quantity,
          status: ReservationStatus.ACTIVE,
          expiresAt,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: InventoryMovementType.RESERVATION,
          quantity: -item.quantity,
          orderId,
          reservationId: reservation.id,
          reason: 'Order placed (awaiting payment)',
        },
      });

      const newStock = v.stock - item.quantity;
      if (newStock <= v.lowStockThreshold) {
        const open = await tx.lowStockNotification.findFirst({
          where: { variantId: item.variantId, resolvedAt: null },
          select: { id: true },
        });
        if (!open) {
          await tx.lowStockNotification.create({
            data: {
              variantId: item.variantId,
              threshold: v.lowStockThreshold,
              stockAtTrigger: newStock,
            },
          });
        }
      }
    }
  }

  /** Payment confirmed: the reservation becomes a committed sale. No stock change. */
  async commitReservations(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.inventoryReservation.updateMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.COMMITTED },
    });
  }

  /**
   * Restock an order's ACTIVE reservations (payment failed/cancelled/expired).
   * Idempotent: only ACTIVE reservations are touched, so duplicate IPN/cron
   * calls are harmless.
   */
  async releaseReservations(
    orderId: string,
    reason: 'cancel' | 'fail' | 'expiry',
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.inventoryReservation.findMany({
        where: { orderId, status: ReservationStatus.ACTIVE },
      });
      if (reservations.length === 0) return 0;

      const ids = [...new Set(reservations.map((r) => r.variantId))].sort();
      await tx.$queryRaw`SELECT id FROM ProductVariant WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;

      const status =
        reason === 'expiry'
          ? ReservationStatus.EXPIRED
          : ReservationStatus.RELEASED;
      const moveType =
        reason === 'expiry'
          ? InventoryMovementType.RESERVATION_EXPIRY
          : InventoryMovementType.RESERVATION_RELEASE;

      for (const r of reservations) {
        await tx.productVariant.update({
          where: { id: r.variantId },
          data: { stock: { increment: r.quantity } },
        });
        await tx.inventoryReservation.update({
          where: { id: r.id },
          data: { status },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: r.variantId,
            type: moveType,
            quantity: r.quantity,
            orderId,
            reservationId: r.id,
            reason: `Reservation ${reason}`,
          },
        });
      }
      return reservations.length;
    });
  }

  /**
   * Restock an order's reservations when an admin cancels or refunds it. Unlike
   * releaseReservations (ACTIVE only, for the payment flow), this also restocks
   * COMMITTED reservations (a paid order being cancelled/refunded). Idempotent.
   */
  async restockOrder(
    orderId: string,
    reason: 'cancel' | 'refund',
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.inventoryReservation.findMany({
        where: {
          orderId,
          status: { in: [ReservationStatus.ACTIVE, ReservationStatus.COMMITTED] },
        },
      });
      if (reservations.length === 0) return 0;

      const ids = [...new Set(reservations.map((r) => r.variantId))].sort();
      await tx.$queryRaw`SELECT id FROM ProductVariant WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;

      const moveType =
        reason === 'refund'
          ? InventoryMovementType.REFUND_RESTOCK
          : InventoryMovementType.CANCELLATION_RESTOCK;

      for (const r of reservations) {
        await tx.productVariant.update({
          where: { id: r.variantId },
          data: { stock: { increment: r.quantity } },
        });
        await tx.inventoryReservation.update({
          where: { id: r.id },
          data: { status: ReservationStatus.RELEASED },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: r.variantId,
            type: moveType,
            quantity: r.quantity,
            orderId,
            reservationId: r.id,
            reason: `Admin order ${reason}`,
          },
        });
      }
      return reservations.length;
    });
  }

  /** Admin manual stock adjustment (delta may be negative). */
  async adjustStock(
    variantId: string,
    delta: number,
    actorUserId?: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ProductVariant WHERE id = ${variantId} FOR UPDATE`;
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: delta } },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId,
          type: InventoryMovementType.MANUAL_ADJUSTMENT,
          quantity: delta,
          actorUserId,
          reason: reason ?? 'Manual adjustment',
        },
      });
    });
  }
}
