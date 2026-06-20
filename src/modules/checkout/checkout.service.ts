import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Cart,
  Order,
  OrderStatus,
  PaymentStatus,
  CartStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { variantCurrent } from '../../common/pricing';
import { CouponsService } from '../coupons/coupons.service';
import { InventoryService } from '../inventory/inventory.service';
import { CheckoutDto } from './dto';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * Places an order from a cart: recomputes all money server-side, then in a
   * single transaction creates the order + items, reserves/decrements stock
   * (row-locked), creates a PENDING payment, and converts the cart. Idempotent
   * on idempotencyKey so a double-submit can't create two paid orders.
   * Throws ConflictException (from inventory) if anything sold out — the whole
   * transaction rolls back.
   */
  async placeOrder(
    cart: Cart,
    dto: CheckoutDto,
    idempotencyKey: string,
    customerId?: string | null,
  ): Promise<Order> {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;

    const cartItems = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            name: true,
            price: true,
            salePrice: true,
            product: {
              select: { name: true, basePrice: true, salePrice: true },
            },
          },
        },
      },
    });
    if (cartItems.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // Recompute every price from the DB (incl. active discounts) — never trust
    // the cart snapshot or the client.
    const orderItemsData = cartItems.map((ci) => {
      const unitPrice = variantCurrent(ci.variant, ci.variant.product);
      return {
        variantId: ci.variantId,
        productName: ci.variant.product.name,
        variantName: ci.variant.name,
        sku: ci.variant.sku,
        unitPrice,
        quantity: ci.quantity,
        lineTotal: unitPrice.times(ci.quantity),
      };
    });

    const subtotal = orderItemsData.reduce(
      (s, i) => s.plus(i.lineTotal),
      new Prisma.Decimal(0),
    );
    const shippingTotal = new Prisma.Decimal(0); // flat/free for now
    const taxTotal = new Prisma.Decimal(0);

    // Coupon: validate (read-only) here; the usage slot is claimed atomically
    // inside the transaction below.
    let discountTotal = new Prisma.Decimal(0);
    let appliedCouponId: string | null = null;
    let appliedCouponCode: string | null = null;
    if (dto.couponCode) {
      const { coupon, discount } = await this.coupons.validate(
        dto.couponCode,
        subtotal,
      );
      discountTotal = discount;
      appliedCouponId = coupon.id;
      appliedCouponCode = coupon.code;
    }

    const grandTotal = subtotal
      .plus(shippingTotal)
      .plus(taxTotal)
      .minus(discountTotal);

    const orderNumber = this.makeOrderNumber();
    const tranId = this.makeTranId();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId: customerId ?? null,
            email: dto.email,
            phone: dto.phone || dto.shipPhone || null,
            status: OrderStatus.AWAITING_PAYMENT,
            currency: cart.currency,
            subtotal,
            discountTotal,
            shippingTotal,
            taxTotal,
            grandTotal,
            idempotencyKey,
            couponId: appliedCouponId,
            couponCode: appliedCouponCode,
            shipName: dto.shipName,
            // Single contact phone doubles as the shipping phone.
            shipPhone: dto.phone || dto.shipPhone || '',
            shipLine1: dto.shipLine1,
            shipLine2: dto.shipLine2 ?? null,
            shipCity: dto.shipCity,
            shipDistrict: dto.shipDistrict ?? null,
            shipPostalCode: dto.shipPostalCode ?? null,
            shipCountry: dto.shipCountry || 'Bangladesh',
            items: { create: orderItemsData },
          },
        });

        // Reserve/lock/decrement stock. Throws → whole transaction rolls back.
        await this.inventory.reserveForOrder(
          tx,
          order.id,
          cartItems.map((ci) => ({
            variantId: ci.variantId,
            quantity: ci.quantity,
          })),
        );

        if (appliedCouponId) {
          await this.coupons.redeemInTx(
            tx,
            appliedCouponId,
            order.id,
            null,
            discountTotal,
          );
        }

        await tx.payment.create({
          data: {
            orderId: order.id,
            status: PaymentStatus.PENDING,
            amount: grandTotal,
            currency: cart.currency,
            tranId,
          },
        });

        await tx.cart.update({
          where: { id: cart.id },
          data: { status: CartStatus.CONVERTED },
        });

        return order;
      });
    } catch (e) {
      // Idempotency race: a concurrent identical submit won the unique key.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const dup = await this.prisma.order.findUnique({
          where: { idempotencyKey },
        });
        if (dup) return dup;
      }
      throw e;
    }
  }

  getOrderForConfirmation(orderNumber: string) {
    return this.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, payments: true },
    });
  }

  private makeOrderNumber(): string {
    return (
      'SV' +
      Date.now().toString(36).toUpperCase() +
      randomBytes(2).toString('hex').toUpperCase()
    );
  }

  private makeTranId(): string {
    return `SV-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
  }
}
