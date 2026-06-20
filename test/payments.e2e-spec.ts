import { NestExpressApplication } from '@nestjs/platform-express';
import { PaymentEventType } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { SslcommerzService } from '../src/modules/payments/sslcommerz.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPendingOrder, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('SSLCOMMERZ payments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let sslcommerz: SslcommerzService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    payments = app.get(PaymentsService);
    sslcommerz = app.get(SslcommerzService);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  function mockValidate(resp: Record<string, unknown>) {
    return jest
      .spyOn(sslcommerz, 'validate')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(resp as any);
  }

  it('marks the order PAID on a valid validation and commits the reservation', async () => {
    await resetDb(prisma);
    const { orderId, tranId, amount } = await createPendingOrder(prisma);
    mockValidate({
      status: 'VALID',
      tran_id: tranId,
      val_id: 'VAL-1',
      amount,
      currency: 'BDT',
      risk_level: '0',
    });

    const result = await payments.processValidation(tranId, 'VAL-1', PaymentEventType.IPN);
    expect(result.outcome).toBe('paid');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('PAID');
    expect(order?.paidAt).toBeTruthy();

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('PAID');

    const reservation = await prisma.inventoryReservation.findFirst({ where: { orderId } });
    expect(reservation?.status).toBe('COMMITTED');
  });

  it('is idempotent — a duplicate IPN does not re-validate or double-process', async () => {
    await resetDb(prisma);
    const { orderId, tranId, amount } = await createPendingOrder(prisma);
    const spy = mockValidate({
      status: 'VALID',
      tran_id: tranId,
      val_id: 'VAL-2',
      amount,
      currency: 'BDT',
      risk_level: '0',
    });

    const first = await payments.processValidation(tranId, 'VAL-2', PaymentEventType.IPN);
    const second = await payments.processValidation(tranId, 'VAL-2', PaymentEventType.IPN);

    expect(first.outcome).toBe('paid');
    expect(second.outcome).toBe('already_paid');
    expect(spy).toHaveBeenCalledTimes(1); // 2nd call short-circuits before validating

    const paidPayments = await prisma.payment.count({
      where: { orderId, status: 'PAID' },
    });
    expect(paidPayments).toBe(1);
    const committed = await prisma.inventoryReservation.count({
      where: { orderId, status: 'COMMITTED' },
    });
    expect(committed).toBe(1);
  });

  it('creates a gateway session and persists it', async () => {
    await resetDb(prisma);
    const { orderId, tranId } = await createPendingOrder(prisma);
    jest.spyOn(sslcommerz, 'createSession').mockResolvedValue({
      status: 'SUCCESS',
      sessionkey: 'sk_test_1',
      GatewayPageURL: 'https://sandbox.sslcommerz.com/EasyCheckOut/pay/xyz',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const url = await payments.createPaymentSession(orderId);
    expect(url).toBe('https://sandbox.sslcommerz.com/EasyCheckOut/pay/xyz');

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('SESSION_CREATED');
    expect(payment?.gatewayPageURL).toContain('sslcommerz.com');

    const session = await prisma.sslcommerzSession.findUnique({ where: { tranId } });
    expect(session).toBeTruthy();
    expect(session?.sessionkey).toBe('sk_test_1');
  });
});
