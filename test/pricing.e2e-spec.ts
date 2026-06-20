import { NestExpressApplication } from '@nestjs/platform-express';
import { CartStatus, Prisma } from '@prisma/client';
import {
  productPriceView,
  variantCurrent,
  variantPriceView,
} from '../src/common/pricing';
import { CartService } from '../src/modules/cart/cart.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipping = (): any => ({
  email: 'buyer@test.local',
  shipName: 'Buyer',
  shipPhone: '01700000000',
  shipLine1: '1 Test Road',
  shipCity: 'Dhaka',
  shipCountry: 'Bangladesh',
});

const D = (s: string) => new Prisma.Decimal(s);

describe('Discounted pricing (unit + checkout)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let carts: CartService;
  let checkout: CheckoutService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    carts = app.get(CartService);
    checkout = app.get(CheckoutService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  // ── Pure pricing resolution ────────────────────────────────────────────
  it('product sale price applies only when lower than base', () => {
    expect(productPriceView({ basePrice: D('1000'), salePrice: D('800') })).toMatchObject({
      regular: 1000,
      current: 800,
      onSale: true,
      discountPercent: 20,
    });
    // sale not lower → ignored
    expect(productPriceView({ basePrice: D('1000'), salePrice: D('1200') })).toMatchObject({
      current: 1000,
      onSale: false,
    });
    // no sale
    expect(productPriceView({ basePrice: D('1000'), salePrice: null })).toMatchObject({
      current: 1000,
      onSale: false,
    });
  });

  it('variant pricing resolves at the variant level when it has its own price', () => {
    const product = { basePrice: D('1000'), salePrice: D('900') };
    const variant = { price: D('1200'), salePrice: D('1000') };
    // variant has its own price → product sale must NOT bleed in
    expect(variantCurrent(variant, product).toString()).toBe('1000');
    expect(variantPriceView(variant, product)).toMatchObject({
      regular: 1200,
      current: 1000,
      onSale: true,
    });
  });

  // ── Checkout charges the discounted price ──────────────────────────────
  it('charges the product sale price at checkout', async () => {
    await resetDb(prisma);
    const product = await createProduct(prisma, {
      slug: 'sale-item',
      basePrice: '1000.00',
      salePrice: '800.00',
      stock: 3,
    });
    const cart = await prisma.cart.create({
      data: { sessionToken: 'sale', status: CartStatus.ACTIVE, currency: 'BDT' },
    });
    await carts.addItem(cart, product.variants[0].id, 1);

    const order = await checkout.placeOrder(cart, shipping(), 'sale-key');
    expect(order.grandTotal.toString()).toBe('800');

    const item = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(item?.unitPrice.toString()).toBe('800');
  });

  it('charges the variant sale price when the variant sets its own price', async () => {
    await resetDb(prisma);
    const product = await createProduct(prisma, {
      slug: 'variant-sale',
      basePrice: '1000.00',
      variantPrice: '1200.00',
      variantSalePrice: '1000.00',
      stock: 3,
    });
    const cart = await prisma.cart.create({
      data: { sessionToken: 'vsale', status: CartStatus.ACTIVE, currency: 'BDT' },
    });
    await carts.addItem(cart, product.variants[0].id, 2);

    const order = await checkout.placeOrder(cart, shipping(), 'vsale-key');
    expect(order.grandTotal.toString()).toBe('2000'); // 1000 × 2
  });

  it('ignores a sale price that is not actually lower', async () => {
    await resetDb(prisma);
    const product = await createProduct(prisma, {
      slug: 'fake-sale',
      basePrice: '1000.00',
      salePrice: '1500.00',
      stock: 3,
    });
    const cart = await prisma.cart.create({
      data: { sessionToken: 'fsale', status: CartStatus.ACTIVE, currency: 'BDT' },
    });
    await carts.addItem(cart, product.variants[0].id, 1);

    const order = await checkout.placeOrder(cart, shipping(), 'fsale-key');
    expect(order.grandTotal.toString()).toBe('1000');
  });
});
