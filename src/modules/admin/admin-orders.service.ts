import { Injectable, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PageParams } from '../../common/pagination';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
  ) {}

  async list(params: PageParams, status?: OrderStatus) {
    const where = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          orderNumber: true,
          email: true,
          status: true,
          grandTotal: true,
          currency: true,
          createdAt: true,
          paidAt: true,
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  getDetail(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        paymentEvents: { orderBy: { createdAt: 'desc' }, take: 12 },
        customer: { select: { name: true, email: true } },
        coupon: { select: { code: true } },
        reservations: { include: { variant: { select: { sku: true } } } },
        shipments: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  /** Fulfillment progression (PAID → PROCESSING → SHIPPED → DELIVERED). */
  async markStatus(id: string, status: OrderStatus): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.order.update({ where: { id }, data: { status } });

    if (status === OrderStatus.SHIPPED) {
      const existing = await this.prisma.shipment.findFirst({ where: { orderId: id } });
      if (!existing) {
        await this.prisma.shipment.create({
          data: { orderId: id, status: ShipmentStatus.SHIPPED, shippedAt: new Date() },
        });
      }
    }
    if (status === OrderStatus.DELIVERED) {
      await this.prisma.shipment.updateMany({
        where: { orderId: id },
        data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
      });
      // Cash on Delivery: cash is collected on delivery, so settle the pending
      // COD payment now (bKash orders are already PAID, so this no-ops them).
      const cod = await this.prisma.payment.updateMany({
        where: {
          orderId: id,
          provider: 'cod',
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.PAID, validatedAt: new Date() },
      });
      if (cod.count > 0) {
        await this.prisma.order.update({
          where: { id },
          data: { paidAt: new Date() },
        });
      }
    }
  }

  /** Cancel an order: restock (active or committed) and cancel pending payments. */
  async cancel(id: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.inventory.restockOrder(id, 'cancel');
    await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED },
    });
    await this.prisma.payment.updateMany({
      where: {
        orderId: id,
        status: {
          notIn: [
            PaymentStatus.PAID,
            PaymentStatus.REFUNDED,
            PaymentStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
      data: { status: PaymentStatus.CANCELLED },
    });
  }

  /**
   * Refund an order's captured bKash payment (full refund). The actual gateway
   * call + state transition (payment/order → REFUNDED, restock) lives in
   * PaymentsService so it stays the single owner of payment-state writes.
   */
  async refund(id: string): Promise<{ ok: boolean; message: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.payments.refund(id);
  }

  /** Approve a PAYMENT_REVIEW order: commit its reservations and mark it paid. */
  async approveReview(id: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.PAID, paidAt: new Date() },
      });
      await tx.payment.updateMany({
        where: { orderId: id, status: PaymentStatus.PAYMENT_REVIEW },
        data: { status: PaymentStatus.PAID, validatedAt: new Date() },
      });
      await this.inventory.commitReservations(id, tx);
    });
  }
}
