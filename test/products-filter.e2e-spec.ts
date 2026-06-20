import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { parsePage } from '../src/common/pagination';
import { ProductFilters } from '../src/common/product-filters';
import { ProductsService } from '../src/modules/catalog/products.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createProduct, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

const filters = (over: Partial<ProductFilters> = {}): ProductFilters => ({
  sort: 'newest',
  inStock: false,
  onSale: false,
  ...over,
});

describe('Product listing filters + sorting (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let products: ProductsService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    products = app.get(ProductsService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function seedCatalog() {
    await resetDb(prisma);
    await createProduct(prisma, { slug: 'p-cheap', basePrice: '1000.00', stock: 2 });
    await createProduct(prisma, { slug: 'p-mid', basePrice: '3000.00', stock: 2 });
    await createProduct(prisma, { slug: 'p-high', basePrice: '8000.00', stock: 2 });
    await createProduct(prisma, { slug: 'p-sale', basePrice: '5000.00', salePrice: '4000.00', stock: 2 });
    await createProduct(prisma, { slug: 'p-oos', basePrice: '2000.00', stock: 0 });
  }

  const slugs = (items: { slug: string }[]) => items.map((i) => i.slug);

  it('sorts by price ascending and descending', async () => {
    await seedCatalog();
    const asc = await products.listActive(parsePage(), { filters: filters({ sort: 'price_asc' }) });
    expect(slugs(asc.items)).toEqual(['p-cheap', 'p-oos', 'p-mid', 'p-sale', 'p-high']);

    const desc = await products.listActive(parsePage(), { filters: filters({ sort: 'price_desc' }) });
    expect(slugs(desc.items)[0]).toBe('p-high');
    expect(slugs(desc.items)[slugs(desc.items).length - 1]).toBe('p-cheap');
  });

  it('filters by price range', async () => {
    await seedCatalog();
    const res = await products.listActive(parsePage(), {
      filters: filters({ priceMin: 3000, priceMax: 8000 }),
    });
    const s = slugs(res.items);
    expect(s).toEqual(expect.arrayContaining(['p-mid', 'p-sale', 'p-high']));
    expect(s).not.toContain('p-cheap');
    expect(s).not.toContain('p-oos');
    expect(res.total).toBe(3);
  });

  it('filters to on-sale only', async () => {
    await seedCatalog();
    const res = await products.listActive(parsePage(), { filters: filters({ onSale: true }) });
    expect(slugs(res.items)).toEqual(['p-sale']);
  });

  it('filters to in-stock only (excludes sold out)', async () => {
    await seedCatalog();
    const res = await products.listActive(parsePage(), { filters: filters({ inStock: true }) });
    expect(slugs(res.items)).not.toContain('p-oos');
    expect(res.total).toBe(4);
  });

  it('renders the Shop page with the filter form', async () => {
    await seedCatalog();
    const res = await request(app.getHttpServer()).get('/products?sort=price_asc&priceMin=2000');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Shop all');
    expect(res.text).toContain('name="priceMin"');
    expect(res.text).toContain('Price: low to high');
    // price filter applied → cheapest (1000) excluded
    expect(res.text).not.toContain('/p/p-cheap"');
    expect(res.text).toContain('/p/p-high"');
  });
});
