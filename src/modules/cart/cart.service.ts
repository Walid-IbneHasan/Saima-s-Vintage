import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cart, CartStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProductPricing, variantCurrent } from '../../common/pricing';
import { variantLabel } from '../../common/variant-label';

const COOKIE = 'sv_cart';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private get isProd(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /** Find the active cart for this client; create one (and set cookie) if asked. */
  async resolveCart(
    req: Request,
    res: Response,
    create = false,
  ): Promise<Cart | null> {
    const token = req.cookies?.[COOKIE] as string | undefined;
    let cart = token
      ? await this.prisma.cart.findFirst({
          where: { sessionToken: token, status: CartStatus.ACTIVE },
        })
      : null;

    if (!cart && create) {
      const newToken = randomUUID();
      cart = await this.prisma.cart.create({
        data: {
          sessionToken: newToken,
          status: CartStatus.ACTIVE,
          currency: process.env.DEFAULT_CURRENCY ?? 'BDT',
        },
      });
      res.cookie(COOKIE, newToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.isProd,
        maxAge: THIRTY_DAYS,
        path: '/',
      });
    }
    return cart;
  }

  /** Cheap sum of item quantities for the header cart badge (no full view build). */
  async count(cart: Cart | null): Promise<number> {
    if (!cart) return 0;
    const agg = await this.prisma.cartItem.aggregate({
      where: { cartId: cart.id },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  async addItem(cart: Cart, variantId: string, quantity: number): Promise<void> {
    if (quantity < 1) throw new ConflictException('Quantity must be at least 1');

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isActive: true },
      select: {
        id: true,
        price: true,
        salePrice: true,
        stock: true,
        product: {
          select: {
            isActive: true,
            basePrice: true,
            salePrice: true,
            flashPrice: true,
            flashStartAt: true,
            flashEndAt: true,
            allowBackorder: true,
            maxPerOrder: true,
          },
        },
      },
    });
    if (!variant || !variant.product.isActive) {
      throw new NotFoundException('This product is no longer available');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      select: { quantity: true },
    });
    const newQty = (existing?.quantity ?? 0) + quantity;

    this.assertWithinLimits(newQty, variant.stock, variant.product);

    // Charge the discounted price when on sale (variant- or product-level), or
    // the flash-deal price while a flash is live. Snapshotted at add time.
    const unitPrice = variantCurrent(
      variant,
      resolveProductPricing(variant.product, new Date()),
    );
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      update: { quantity: newQty, unitPriceSnapshot: unitPrice },
      create: {
        cartId: cart.id,
        variantId,
        quantity: newQty,
        unitPriceSnapshot: unitPrice,
      },
    });
  }

  async updateItem(cart: Cart, itemId: string, quantity: number): Promise<void> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: {
        variant: {
          select: {
            stock: true,
            product: { select: { allowBackorder: true, maxPerOrder: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Cart item not found');

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
      return;
    }
    this.assertWithinLimits(quantity, item.variant.stock, item.variant.product);
    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity },
    });
  }

  async removeItem(cart: Cart, itemId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cartId: cart.id },
    });
  }

  async getView(cart: Cart | null) {
    if (!cart) return { items: [], subtotal: new Prisma.Decimal(0), count: 0 };

    const rows = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' },
      include: {
        variant: {
          select: {
            id: true,
            name: true,
            size: true,
            color: true,
            price: true,
            stock: true,
            product: {
              select: {
                name: true,
                slug: true,
                basePrice: true,
                allowBackorder: true,
                images: {
                  take: 1,
                  orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
                  select: { url: true, alt: true },
                },
              },
            },
          },
        },
      },
    });

    let subtotal = new Prisma.Decimal(0);
    let count = 0;
    const items = rows.map((r) => {
      const lineTotal = r.unitPriceSnapshot.times(r.quantity);
      subtotal = subtotal.plus(lineTotal);
      count += r.quantity;
      // The snapshot is the charged (possibly discounted) price; regular is for
      // struck-through display.
      const regular = r.variant.price ?? r.variant.product.basePrice;
      return {
        id: r.id,
        productName: r.variant.product.name,
        productSlug: r.variant.product.slug,
        variantName: r.variant.name,
        variant: variantLabel(r.variant),
        color: r.variant.color,
        unitPrice: r.unitPriceSnapshot,
        regularPrice: regular,
        onSale: regular.greaterThan(r.unitPriceSnapshot),
        quantity: r.quantity,
        lineTotal,
        image: r.variant.product.images[0] ?? null,
        stock: r.variant.stock,
        allowBackorder: r.variant.product.allowBackorder,
      };
    });

    return { items, subtotal, count };
  }

  private assertWithinLimits(
    qty: number,
    stock: number,
    product: { allowBackorder: boolean; maxPerOrder: number | null },
  ): void {
    if (product.maxPerOrder && qty > product.maxPerOrder) {
      throw new ConflictException(`Limit is ${product.maxPerOrder} per order`);
    }
    if (!product.allowBackorder && qty > stock) {
      throw new ConflictException(
        stock <= 0 ? 'Sold out' : `Only ${stock} available`,
      );
    }
  }
}
