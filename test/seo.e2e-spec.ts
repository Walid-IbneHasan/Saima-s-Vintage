import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createCategory, createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('SEO + sitemap (e2e)', () => {
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

  it('renders Product + BreadcrumbList JSON-LD and a canonical link on the PDP', async () => {
    const res = await request(app.getHttpServer()).get('/p/test-dress');
    expect(res.status).toBe(200);
    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('"@type":"Product"');
    expect(res.text).toContain('"@type":"BreadcrumbList"');
    expect(res.text).toContain('schema.org/InStock');
    expect(res.text).toMatch(/<link rel="canonical" href="[^"]*\/p\/test-dress"/);
  });

  it('serves a sitemap listing product and category URLs', async () => {
    const res = await request(app.getHttpServer()).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    expect(res.text).toContain('<urlset');
    expect(res.text).toContain('/p/test-dress');
    expect(res.text).toContain('/c/dresses');
  });

  it('serves robots.txt that blocks admin and points to the sitemap', async () => {
    const res = await request(app.getHttpServer()).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Sitemap:');
  });

  it('sets a hardened CSP header', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
  });

  it('home renders its content server-side (JS-optional) with polish markup', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    // Content is present in the HTML regardless of JS (no reveal-hidden gating
    // server-side); the animation hooks are progressive enhancements.
    expect(res.text).toContain('hero-fade');
    expect(res.text).toContain('Curated vintage treasures');
  });
});
