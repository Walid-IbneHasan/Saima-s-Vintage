// Enable Prisma query events BEFORE the app (and its PrismaService) is built.
process.env.PRISMA_LOG_QUERIES = '1';

import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCategory, createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Products listing (N+1) + detail (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  let counting = false;
  let queryCount = 0;

  async function withQueryCount(fn: () => Promise<unknown>): Promise<number> {
    queryCount = 0;
    counting = true;
    await fn();
    counting = false;
    return queryCount;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$on('query', () => {
      if (counting) queryCount += 1;
    });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function seedProducts(n: number, prefix: string): Promise<string> {
    await resetDb(prisma);
    const cat = await createCategory(prisma, 'dresses', 'Dresses');
    for (let i = 0; i < n; i++) {
      await createProduct(prisma, {
        slug: `${prefix}-${i}`,
        name: `${prefix} ${i}`,
        sku: `${prefix}-${i}`,
        categoryId: cat.id,
      });
    }
    return cat.id;
  }

  it('issues a constant number of queries regardless of product count (no N+1)', async () => {
    await seedProducts(3, 'small');
    const small = await withQueryCount(() =>
      request(app.getHttpServer()).get('/c/dresses').expect(200),
    );

    await seedProducts(12, 'big');
    const big = await withQueryCount(() =>
      request(app.getHttpServer()).get('/c/dresses').expect(200),
    );

    // Constant query count is the signature of no N+1; allow ±1 for tx framing.
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(15);
    expect(big).toBeLessThanOrEqual(small + 1);
  });

  it('product detail loads an active product with its variant', async () => {
    await resetDb(prisma);
    await createProduct(prisma, { slug: 'active-dress', name: 'Active Dress', stock: 1 });

    const res = await request(app.getHttpServer()).get('/p/active-dress');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Active Dress');
    expect(res.text).toContain('Add to cart'); // in stock → purchasable
  });

  it('does not expose an inactive product (404)', async () => {
    await resetDb(prisma);
    await createProduct(prisma, {
      slug: 'hidden-dress',
      name: 'Hidden Dress',
      isActive: false,
    });

    const res = await request(app.getHttpServer()).get('/p/hidden-dress');
    expect(res.status).toBe(404);
  });
});
