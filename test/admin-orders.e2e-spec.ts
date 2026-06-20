import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAdmin, createPendingOrder, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'Passw0rd!';

function extractCsrf(html: string): string {
  const m = /name="_csrf" value="([a-f0-9]{32,})"/.exec(html);
  if (!m) throw new Error('CSRF token not found');
  return m[1];
}

describe('Admin orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token = '';
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await createAdmin(prisma, ADMIN_EMAIL, ADMIN_PASSWORD);

    agent = request.agent(app.getHttpServer());
    token = extractCsrf((await agent.get('/admin/login')).text);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: token })
      .expect(302);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  async function makePaid() {
    const o = await createPendingOrder(prisma); // AWAITING, ACTIVE reservation, stock 1→0
    await prisma.order.update({ where: { id: o.orderId }, data: { status: 'PAID', paidAt: new Date() } });
    await prisma.inventoryReservation.updateMany({ where: { orderId: o.orderId }, data: { status: 'COMMITTED' } });
    await prisma.payment.updateMany({ where: { orderId: o.orderId }, data: { status: 'PAID' } });
    return o;
  }

  it('requires authentication', async () => {
    const res = await request(app.getHttpServer()).get('/admin/orders');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('lists orders and opens a detail page', async () => {
    const o = await createPendingOrder(prisma);

    const list = await agent.get('/admin/orders');
    expect(list.status).toBe(200);
    expect(list.text).toContain(o.orderNumber);

    const detail = await agent.get(`/admin/orders/${o.orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain(o.orderNumber);
    expect(detail.text).toContain('Ship to');
  });

  it('marks a paid order shipped and records a shipment', async () => {
    const o = await makePaid();
    const res = await agent
      .post(`/admin/orders/${o.orderId}/shipped`)
      .type('form')
      .send({ _csrf: token });
    expect(res.status).toBe(302);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('SHIPPED');
    const shipment = await prisma.shipment.findFirst({ where: { orderId: o.orderId } });
    expect(shipment?.status).toBe('SHIPPED');
  });

  it('cancels a paid order and restocks the items', async () => {
    const o = await makePaid(); // committed reservation, variant stock at 0
    const res = await agent
      .post(`/admin/orders/${o.orderId}/cancel`)
      .type('form')
      .send({ _csrf: token });
    expect(res.status).toBe(302);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('CANCELLED');
    const variant = await prisma.productVariant.findUnique({ where: { id: o.variantId } });
    expect(variant?.stock).toBe(1); // restocked
    const reservation = await prisma.inventoryReservation.findFirst({ where: { orderId: o.orderId } });
    expect(reservation?.status).toBe('RELEASED');
  });

  it('approves a payment_review order and commits the reservation', async () => {
    const o = await createPendingOrder(prisma);
    await prisma.order.update({ where: { id: o.orderId }, data: { status: 'PAYMENT_REVIEW' } });
    await prisma.payment.updateMany({ where: { orderId: o.orderId }, data: { status: 'PAYMENT_REVIEW' } });

    const res = await agent
      .post(`/admin/orders/${o.orderId}/approve-review`)
      .type('form')
      .send({ _csrf: token });
    expect(res.status).toBe(302);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('PAID');
    expect(order?.paidAt).toBeTruthy();
    const reservation = await prisma.inventoryReservation.findFirst({ where: { orderId: o.orderId } });
    expect(reservation?.status).toBe('COMMITTED');
  });
});
