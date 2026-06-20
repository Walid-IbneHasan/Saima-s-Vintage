import { NestExpressApplication } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAdmin, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'Passw0rd!';

function extractCsrf(html: string): string {
  const m = /name="_csrf" value="([a-f0-9]{32,})"/.exec(html);
  if (!m) throw new Error('CSRF token not found in page');
  return m[1];
}

describe('Admin access control + CSRF (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await createAdmin(prisma, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('redirects unauthenticated admin requests to login', async () => {
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('blocks unauthenticated access to admin sub-pages', async () => {
    const res = await request(app.getHttpServer()).get('/admin/products');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('rejects a login POST without a CSRF token (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .type('form')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('logs in with valid credentials + CSRF, then reaches the dashboard', async () => {
    const agent = request.agent(app.getHttpServer());
    const page = await agent.get('/admin/login');
    const token = extractCsrf(page.text);

    const login = await agent
      .post('/admin/login')
      .type('form')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: token });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/admin');
    expect(login.headers['set-cookie'].join(';')).toContain('sv_admin');

    const dash = await agent.get('/admin');
    expect(dash.status).toBe(200);
    expect(dash.text).toContain('Signed in as');
  });

  it('a non-admin (CUSTOMER) user is forbidden from the admin (403)', async () => {
    await prisma.user.create({
      data: {
        email: 'shopper@test.local',
        name: 'Shopper',
        role: Role.CUSTOMER,
        passwordHash: await bcrypt.hash('Shopper1!', 4),
      },
    });

    const agent = request.agent(app.getHttpServer());
    const token = extractCsrf((await agent.get('/admin/login')).text);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ email: 'shopper@test.local', password: 'Shopper1!', _csrf: token })
      .expect(302);

    const res = await agent.get('/admin');
    expect(res.status).toBe(403); // authenticated but wrong role
  });

  it('an authenticated admin can create a product', async () => {
    const agent = request.agent(app.getHttpServer());
    const token = extractCsrf((await agent.get('/admin/login')).text);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: token })
      .expect(302);

    const create = await agent
      .post('/admin/products')
      .type('form')
      .send({ name: 'CSRF Test Product', basePrice: '777.00', isActive: 'on', _csrf: token });
    expect(create.status).toBe(302);

    const product = await prisma.product.findFirst({
      where: { name: 'CSRF Test Product' },
    });
    expect(product).toBeTruthy();
    expect(product?.slug).toBe('csrf-test-product');
  });
});
