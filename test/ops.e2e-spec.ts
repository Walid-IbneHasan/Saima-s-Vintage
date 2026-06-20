import { NestExpressApplication } from '@nestjs/platform-express';
import { CartStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { CartService } from '../src/modules/cart/cart.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { CouponsService } from '../src/modules/coupons/coupons.service';
import { MaintenanceService } from '../src/modules/cron/maintenance.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPendingOrder, createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipping = (extra: Record<string, unknown> = {}): any => ({
  email: 'buyer@test.local',
  shipName: 'Buyer',
  shipPhone: '01700000000',
  shipLine1: '1 Test Road',
  shipCity: 'Dhaka',
  shipCountry: 'Bangladesh',
  ...extra,
});

describe('Operations: coupons / cron / jobs (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let coupons: CouponsService;
  let carts: CartService;
  let checkout: CheckoutService;
  let maintenance: MaintenanceService;
  let jobs: JobsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    coupons = app.get(CouponsService);
    carts = app.get(CartService);
    checkout = app.get(CheckoutService);
    maintenance = app.get(MaintenanceService);
    jobs = app.get(JobsService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  // ── Coupons ──────────────────────────────────────────────────────────────

  describe('coupon validation', () => {
    it('computes a percentage discount (case-insensitive code)', async () => {
      await resetDb(prisma);
      await prisma.coupon.create({
        data: { code: 'SAVE10', type: 'PERCENT', value: 10, isActive: true },
      });
      const result = await coupons.validate('save10', new Prisma.Decimal('1000'));
      expect(result.discount.toString()).toBe('100');
    });

    it('caps a percentage discount at maxDiscount', async () => {
      await resetDb(prisma);
      await prisma.coupon.create({
        data: { code: 'BIG', type: 'PERCENT', value: 50, isActive: true, maxDiscount: 100 },
      });
      const result = await coupons.validate('BIG', new Prisma.Decimal('1000'));
      expect(result.discount.toString()).toBe('100'); // 500 capped to 100
    });

    it('rejects an expired coupon', async () => {
      await resetDb(prisma);
      await prisma.coupon.create({
        data: {
          code: 'OLD',
          type: 'FIXED',
          value: 50,
          isActive: true,
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      });
      await expect(
        coupons.validate('OLD', new Prisma.Decimal('1000')),
      ).rejects.toThrow();
    });

    it('enforces minimum subtotal', async () => {
      await resetDb(prisma);
      await prisma.coupon.create({
        data: {
          code: 'MIN500',
          type: 'FIXED',
          value: 100,
          isActive: true,
          minSubtotal: 500,
        },
      });
      await expect(
        coupons.validate('MIN500', new Prisma.Decimal('100')),
      ).rejects.toThrow();
    });
  });

  it('applies a coupon at checkout and records the redemption', async () => {
    await resetDb(prisma);
    const product = await createProduct(prisma, { slug: 'coupon-item', stock: 5 });
    const coupon = await prisma.coupon.create({
      data: { code: 'TENOFF', type: 'PERCENT', value: 10, isActive: true, usageLimit: 1 },
    });
    const cart = await prisma.cart.create({
      data: { sessionToken: 'cpn', status: CartStatus.ACTIVE, currency: 'BDT' },
    });
    await carts.addItem(cart, product.variants[0].id, 1); // subtotal 1000

    const order = await checkout.placeOrder(cart, shipping({ couponCode: 'TENOFF' }), 'cpn-key');
    expect(order.discountTotal.toString()).toBe('100');
    expect(order.grandTotal.toString()).toBe('900');
    expect(order.couponCode).toBe('TENOFF');

    const redemptions = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
    expect(redemptions).toBe(1);
    const fresh = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(fresh?.usedCount).toBe(1);
  });

  it('rejects a coupon that has hit its usage limit', async () => {
    await resetDb(prisma);
    await prisma.coupon.create({
      data: { code: 'ONCE', type: 'FIXED', value: 50, isActive: true, usageLimit: 1, usedCount: 1 },
    });
    await expect(
      coupons.validate('ONCE', new Prisma.Decimal('1000')),
    ).rejects.toThrow();
  });

  // ── Cron: expire unpaid orders ─────────────────────────────────────────────

  it('expires unpaid orders past TTL and restocks (idempotent)', async () => {
    await resetDb(prisma);
    const { orderId, variantId } = await createPendingOrder(prisma); // stock 1 → 0
    // force the reservation to be expired
    await prisma.inventoryReservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await maintenance.expireUnpaidOrders();
    expect(expired).toBe(1);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('EXPIRED');
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    expect(variant?.stock).toBe(1); // restocked

    // running again is a no-op
    expect(await maintenance.expireUnpaidOrders()).toBe(0);
  });

  // ── Cron: low-stock scan ───────────────────────────────────────────────────

  it('flags low-stock variants once and enqueues an alert', async () => {
    await resetDb(prisma);
    await createProduct(prisma, { slug: 'low-item', stock: 1 }); // threshold default 3 → low

    const flagged = await maintenance.scanLowStock();
    expect(flagged).toBe(1);
    expect(await prisma.lowStockNotification.count()).toBe(1);
    expect(await prisma.job.count({ where: { type: 'email.low_stock' } })).toBe(1);

    // does not re-flag while the notification is unresolved
    expect(await maintenance.scanLowStock()).toBe(0);
  });

  // ── Jobs queue ─────────────────────────────────────────────────────────────

  it('drains a queued job exactly once', async () => {
    await resetDb(prisma);
    await jobs.enqueue('email.generic', {
      to: 'x@test.local',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    const first = await jobs.drain(10);
    expect(first.processed).toBe(1);

    const job = await prisma.job.findFirst({ where: { type: 'email.generic' } });
    expect(job?.status).toBe('DONE');

    // nothing left to do
    const second = await jobs.drain(10);
    expect(second.processed).toBe(0);
  });

  it('marks an unknown job type FAILED after exhausting retries', async () => {
    await resetDb(prisma);
    const id = await jobs.enqueue('does.not.exist', {});
    // maxAttempts defaults to 5; drain retries set runAt in the future, so a
    // single drain attempts once and reschedules. Force attempts to the limit.
    await prisma.job.update({ where: { id }, data: { attempts: 4 } });
    await jobs.drain(10);
    const job = await prisma.job.findUnique({ where: { id } });
    expect(job?.status).toBe('FAILED');
    expect(job?.lastError).toContain('Unknown job type');
  });

  // ── Cron endpoint guard ────────────────────────────────────────────────────

  it('rejects cron endpoints without the secret token', async () => {
    const res = await request(app.getHttpServer()).post('/internal/cron/run-jobs');
    expect(res.status).toBe(401);
  });

  it('accepts cron endpoints with the correct token', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/cron/run-jobs')
      .set('X-Cron-Token', process.env.CRON_TOKEN ?? '');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('processed');
  });
});
