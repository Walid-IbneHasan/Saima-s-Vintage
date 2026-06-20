import { NestExpressApplication } from '@nestjs/platform-express';
import {
  CartStatus,
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
} from '@prisma/client';
import { CartService } from '../src/modules/cart/cart.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipping = (email = 'buyer@test.local'): any => ({
  email,
  shipName: 'Buyer',
  shipPhone: '01700000000',
  shipLine1: '1 Test Road',
  shipCity: 'Dhaka',
  shipCountry: 'Bangladesh',
});

describe('Cart + Checkout + Inventory (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let carts: CartService;
  let checkout: CheckoutService;
  let inventory: InventoryService;
  let seq = 0;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    carts = app.get(CartService);
    checkout = app.get(CheckoutService);
    inventory = app.get(InventoryService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function makeVariant(
    stock: number,
    opts: { allowBackorder?: boolean; maxPerOrder?: number } = {},
  ): Promise<{ id: string }> {
    seq += 1;
    const product = await prisma.product.create({
      data: {
        name: `Item ${seq}`,
        slug: `item-${seq}`,
        sku: `SKU-${seq}`,
        basePrice: '1000.00',
        isActive: true,
        publishedAt: new Date(),
        allowBackorder: opts.allowBackorder ?? false,
        maxPerOrder: opts.maxPerOrder ?? null,
        variants: { create: { sku: `V-${seq}`, name: 'Default', stock } },
      },
      include: { variants: true },
    });
    return product.variants[0];
  }

  function newCart(token: string) {
    return prisma.cart.create({
      data: { sessionToken: token, status: CartStatus.ACTIVE, currency: 'BDT' },
    });
  }

  it('cannot add an out-of-stock variant to the cart', async () => {
    await resetDb(prisma);
    const v = await makeVariant(0);
    const cart = await newCart('oos');
    await expect(carts.addItem(cart, v.id, 1)).rejects.toThrow();
  });

  it('cannot add more than the available stock', async () => {
    await resetDb(prisma);
    const v = await makeVariant(2);
    const cart = await newCart('over');
    await expect(carts.addItem(cart, v.id, 3)).rejects.toThrow();
    await carts.addItem(cart, v.id, 2); // exactly stock is fine
    expect(await prisma.cartItem.count({ where: { cartId: cart.id } })).toBe(1);
  });

  it('placeOrder creates an awaiting-payment order, reserves stock, pending payment', async () => {
    await resetDb(prisma);
    const v = await makeVariant(5);
    const cart = await newCart('ok');
    await carts.addItem(cart, v.id, 2);

    const order = await checkout.placeOrder(cart, shipping(), 'key-create');
    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);

    const variant = await prisma.productVariant.findUnique({ where: { id: v.id } });
    expect(variant?.stock).toBe(3); // 5 - 2

    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: order.id },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe(ReservationStatus.ACTIVE);

    const payment = await prisma.payment.findFirst({ where: { orderId: order.id } });
    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(payment?.amount.toString()).toBe('2000');

    const movements = await prisma.inventoryMovement.count({
      where: { orderId: order.id, type: 'RESERVATION' },
    });
    expect(movements).toBe(1);
  });

  it('is idempotent on idempotencyKey (no duplicate order or double decrement)', async () => {
    await resetDb(prisma);
    const v = await makeVariant(5);
    const cart = await newCart('idem');
    await carts.addItem(cart, v.id, 1);

    const o1 = await checkout.placeOrder(cart, shipping(), 'dup-key');
    const o2 = await checkout.placeOrder(cart, shipping(), 'dup-key');
    expect(o2.id).toBe(o1.id);
    expect(await prisma.order.count()).toBe(1);

    const variant = await prisma.productVariant.findUnique({ where: { id: v.id } });
    expect(variant?.stock).toBe(4); // decremented exactly once
  });

  it('two concurrent checkouts for the last unit cannot oversell', async () => {
    await resetDb(prisma);
    const v = await makeVariant(1);
    const cartA = await newCart('A');
    const cartB = await newCart('B');
    await carts.addItem(cartA, v.id, 1);
    await carts.addItem(cartB, v.id, 1);

    const results = await Promise.allSettled([
      checkout.placeOrder(cartA, shipping('a@test.local'), 'keyA'),
      checkout.placeOrder(cartB, shipping('b@test.local'), 'keyB'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const variant = await prisma.productVariant.findUnique({ where: { id: v.id } });
    expect(variant?.stock).toBe(0); // never negative
    expect(await prisma.order.count()).toBe(1);
    expect(
      await prisma.inventoryReservation.count({
        where: { status: ReservationStatus.ACTIVE },
      }),
    ).toBe(1);
  });

  it('releasing reservations restocks and is idempotent', async () => {
    await resetDb(prisma);
    const v = await makeVariant(3);
    const cart = await newCart('rel');
    await carts.addItem(cart, v.id, 2);
    const order = await checkout.placeOrder(cart, shipping(), 'rel-key');

    expect((await prisma.productVariant.findUnique({ where: { id: v.id } }))?.stock).toBe(1);

    const released = await inventory.releaseReservations(order.id, 'cancel');
    expect(released).toBe(1);
    expect((await prisma.productVariant.findUnique({ where: { id: v.id } }))?.stock).toBe(3);

    // second release is a no-op (idempotent — safe for duplicate IPN/cron)
    const again = await inventory.releaseReservations(order.id, 'cancel');
    expect(again).toBe(0);
    expect((await prisma.productVariant.findUnique({ where: { id: v.id } }))?.stock).toBe(3);

    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(reservation?.status).toBe(ReservationStatus.RELEASED);
  });
});
