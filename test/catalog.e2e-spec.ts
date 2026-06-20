import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCategory, createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('Storefront catalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    const category = await createCategory(prisma);
    await createProduct(prisma, { categoryId: category.id });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('loads an active product detail page with its name', async () => {
    const res = await request(app.getHttpServer()).get('/p/test-dress');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Dress');
  });

  it('returns 404 for an unknown product slug', async () => {
    const res = await request(app.getHttpServer()).get('/p/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('finds the product via MySQL full-text search', async () => {
    const res = await request(app.getHttpServer()).get('/search?q=test');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/p/test-dress');
  });

  it('renders the category listing page', async () => {
    const res = await request(app.getHttpServer()).get('/c/dresses');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Dress');
  });
});
