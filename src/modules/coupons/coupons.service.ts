import { BadRequestException, Injectable } from '@nestjs/common';
import { Coupon, CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a code against a subtotal and return the discount. Throws
   * BadRequestException with a customer-facing reason if not applicable.
   * Does NOT mutate usage — call redeemInTx() inside the checkout transaction.
   */
  async validate(
    code: string,
    subtotal: Prisma.Decimal,
    customerId?: string,
  ): Promise<{ coupon: Coupon; discount: Prisma.Decimal }> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('Invalid coupon code');
    }
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('This coupon is not active yet');
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }
    if (coupon.minSubtotal && subtotal.lessThan(coupon.minSubtotal)) {
      throw new BadRequestException(
        `Spend at least ৳${coupon.minSubtotal.toString()} to use this coupon`,
      );
    }
    if (coupon.usageLimitPerCustomer && customerId) {
      const used = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, customerId },
      });
      if (used >= coupon.usageLimitPerCustomer) {
        throw new BadRequestException('You have already used this coupon');
      }
    }

    return { coupon, discount: this.computeDiscount(coupon, subtotal) };
  }

  private computeDiscount(coupon: Coupon, subtotal: Prisma.Decimal): Prisma.Decimal {
    let discount: Prisma.Decimal;
    if (coupon.type === CouponType.PERCENT) {
      discount = subtotal.times(coupon.value).dividedBy(100);
      if (coupon.maxDiscount && discount.greaterThan(coupon.maxDiscount)) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.value;
    }
    if (discount.greaterThan(subtotal)) discount = subtotal;
    return discount.toDecimalPlaces(2);
  }

  /**
   * Atomically claim a redemption slot and record it, inside the caller's
   * transaction. The conditional UPDATE prevents exceeding usageLimit under
   * concurrency; throws if the coupon was exhausted in the meantime.
   */
  async redeemInTx(
    tx: Prisma.TransactionClient,
    couponId: string,
    orderId: string,
    customerId: string | null,
    amount: Prisma.Decimal,
  ): Promise<void> {
    const claimed = await tx.$executeRaw`
      UPDATE Coupon SET usedCount = usedCount + 1
      WHERE id = ${couponId}
        AND (usageLimit IS NULL OR usedCount < usageLimit)
    `;
    if (claimed === 0) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }
    await tx.couponRedemption.create({
      data: { couponId, orderId, customerId, amount },
    });
  }
}
