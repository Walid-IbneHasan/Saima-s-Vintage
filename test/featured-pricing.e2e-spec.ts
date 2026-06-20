import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCategory, createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Featured discounted pricing UI (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('renders discounted pricing and badge on the PDP', async () => {
    await resetDb(prisma);
    const category = await createCategory(prisma);
    await createProduct(prisma, {
      slug: 'pdp-sale',
      basePrice: '1000.00',
      salePrice: '800.00',
      categoryId: category.id,
    });

    const res = await request(app.getHttpServer()).get('/p/pdp-sale');

    expect(res.status).toBe(200);
    expect(res.text).toContain('800');
    expect(res.text).toContain('-20% off');
  });

  it('renders featured products in featuredOrder order on home', async () => {
    await resetDb(prisma);
    const category = await createCategory(prisma);
    await createProduct(prisma, {
      slug: 'feat-a',
      isFeatured: true,
      featuredOrder: 1,
      categoryId: category.id,
    });
    await createProduct(prisma, {
      slug: 'feat-b',
      isFeatured: true,
      featuredOrder: 0,
      categoryId: category.id,
    });

    const res = await request(app.getHttpServer()).get('/');

    expect(res.status).toBe(200);
    const featA = res.text.indexOf('/p/feat-a');
    const featB = res.text.indexOf('/p/feat-b');
    expect(featA).toBeGreaterThanOrEqual(0);
    expect(featB).toBeGreaterThanOrEqual(0);
    expect(featB).toBeLessThan(featA);
  });

  it('renders a non-sale featured product with no discount badge', async () => {
    await resetDb(prisma);
    const category = await createCategory(prisma);
    await createProduct(prisma, {
      slug: 'feat-regular',
      basePrice: '1000.00',
      isFeatured: true,
      categoryId: category.id,
    });

    const res = await request(app.getHttpServer()).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('/p/feat-regular');
    expect(res.text).toContain('1,000.00');
    expect(res.text).not.toContain('% off');
    expect(res.text).not.toContain('bg-amber-100 px-2');
  });
});
