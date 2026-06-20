import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AdminReviewsService } from '../src/modules/admin/admin-reviews.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Purchase-gated reviews (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let adminReviews: AdminReviewsService;
  let seq = 0;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    reviews = app.get(ReviewsService);
    adminReviews = app.get(AdminReviewsService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function purchase(opts: { slug: string; email: string; withPassword?: boolean }) {
    seq += 1;
    const product = await createProduct(prisma, { slug: opts.slug, stock: 5 });
    const variant = product.variants[0];
    const customer = await prisma.customer.create({
      data: {
        email: opts.email,
        name: 'Buyer',
        emailVerifiedAt: new Date(),
        ...(opts.withPassword ? { passwordHash: await bcrypt.hash('Password1', 4) } : {}),
      },
    });
    await prisma.order.create({
      data: {
        orderNumber: `REV${seq}`,
        email: opts.email,
        customerId: customer.id,
        status: 'PAID',
        currency: 'BDT',
        subtotal: '1000',
        grandTotal: '1000',
        idempotencyKey: `rev-${seq}`,
        shipName: 'B',
        shipPhone: '01700000000',
        shipLine1: 'x',
        shipCity: 'Dhaka',
        shipCountry: 'Bangladesh',
        paidAt: new Date(),
        items: {
          create: {
            variantId: variant.id,
            productName: product.name,
            variantName: variant.name,
            sku: variant.sku,
            unitPrice: '1000',
            quantity: 1,
            lineTotal: '1000',
          },
        },
      },
    });
    return { product, customer };
  }

  it('lets a purchaser review, blocks non-purchasers and duplicates', async () => {
    await resetDb(prisma);
    const { product, customer } = await purchase({ slug: 'rev-a', email: 'buyer@rev.local' });

    expect(await reviews.canReview(customer.id, product.id)).toBe(true);
    await reviews.create(customer.id, 'Buyer', product.id, 5, 'Great', 'Loved it');
    expect(
      await prisma.review.count({ where: { productId: product.id, customerId: customer.id } }),
    ).toBe(1);

    // duplicate review by same customer
    await expect(
      reviews.create(customer.id, 'Buyer', product.id, 4, 'again', 'again'),
    ).rejects.toThrow();

    // a customer who didn't buy it
    const other = await prisma.customer.create({
      data: { email: 'nope@rev.local', name: 'Nope', emailVerifiedAt: new Date() },
    });
    expect(await reviews.canReview(other.id, product.id)).toBe(false);
    await expect(
      reviews.create(other.id, 'Nope', product.id, 5, 't', 'b'),
    ).rejects.toThrow();
  });

  it('admin can delete a review', async () => {
    await resetDb(prisma);
    const { product, customer } = await purchase({ slug: 'rev-b', email: 'b2@rev.local' });
    await reviews.create(customer.id, 'Buyer', product.id, 5, 't', 'b');
    const review = await prisma.review.findFirst({ where: { productId: product.id } });

    await adminReviews.remove(review!.id);
    expect(await prisma.review.count({ where: { id: review!.id } })).toBe(0);
  });

  it('PDP shows the review form to a logged-in purchaser, login prompt to anonymous', async () => {
    await resetDb(prisma);
    await purchase({ slug: 'rev-pdp', email: 'pdp@rev.local', withPassword: true });

    const agent = request.agent(app.getHttpServer());
    const csrf = /name="_csrf" value="([a-f0-9]{32,})"/.exec((await agent.get('/login')).text)![1];
    await agent
      .post('/login')
      .type('form')
      .send({ email: 'pdp@rev.local', password: 'Password1', _csrf: csrf })
      .expect(302);

    const loggedIn = await agent.get('/p/rev-pdp');
    expect(loggedIn.text).toContain('Write a review');

    const anon = await request(app.getHttpServer()).get('/p/rev-pdp');
    expect(anon.text).toContain('to review products'); // "Log in</a> to review products…"
    expect(anon.text).not.toContain('Write a review');
  });
});
