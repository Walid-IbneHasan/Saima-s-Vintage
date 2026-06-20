import { NestExpressApplication } from '@nestjs/platform-express';
import { PaymentEventType } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { SslcommerzService } from '../src/modules/payments/sslcommerz.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPendingOrder, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('SSLCOMMERZ payments matrix (e2e)', () => {
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

  function validResponse(o: { tranId: string; amount: string }) {
    return {
      status: 'VALID',
      tran_id: o.tranId,
      val_id: 'V',
      amount: o.amount,
      currency: 'BDT',
      risk_level: '0',
    };
  }

  async function expectState(
    o: { orderId: string; tranId: string; variantId: string },
    expected: {
      order: string;
      payment: string;
      reservation: string;
      stock: number;
    },
  ) {
    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe(expected.order);

    const payment = await prisma.payment.findUnique({ where: { tranId: o.tranId } });
    expect(payment?.status).toBe(expected.payment);

    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: o.orderId },
    });
    expect(reservation?.status).toBe(expected.reservation);

    const variant = await prisma.productVariant.findUnique({
      where: { id: o.variantId },
    });
    expect(variant?.stock).toBe(expected.stock);
  }

  it('fails and restocks when validation status is invalid', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate({
      ...validResponse(o),
      status: 'INVALID_TRANSACTION',
    });

    const result = await payments.processValidation(o.tranId, 'V', PaymentEventType.IPN);

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('fails and restocks when validation tran_id does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate({
      ...validResponse(o),
      tran_id: 'WRONG',
    });

    const result = await payments.processValidation(o.tranId, 'V', PaymentEventType.IPN);

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('holds for review when validation currency does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate({
      ...validResponse(o),
      currency: 'USD',
    });

    const result = await payments.processValidation(o.tranId, 'V', PaymentEventType.IPN);

    expect(result.outcome).toBe('review');
    await expectState(o, {
      order: 'PAYMENT_REVIEW',
      payment: 'PAYMENT_REVIEW',
      reservation: 'ACTIVE',
      stock: 0,
    });
  });

  it('holds for review when validation amount does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate({
      ...validResponse(o),
      amount: '1',
    });

    const result = await payments.processValidation(o.tranId, 'V', PaymentEventType.IPN);

    expect(result.outcome).toBe('review');
    await expectState(o, {
      order: 'PAYMENT_REVIEW',
      payment: 'PAYMENT_REVIEW',
      reservation: 'ACTIVE',
      stock: 0,
    });
  });

  it('holds for review when validation risk_level is 1', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate({
      ...validResponse(o),
      risk_level: '1',
    });

    const result = await payments.processValidation(o.tranId, 'V', PaymentEventType.IPN);

    expect(result.outcome).toBe('review');
    await expectState(o, {
      order: 'PAYMENT_REVIEW',
      payment: 'PAYMENT_REVIEW',
      reservation: 'ACTIVE',
      stock: 0,
    });
  });

  it('returns unknown_tran when validation has no matching payment', async () => {
    await resetDb(prisma);

    const result = await payments.processValidation(
      'NO-SUCH-TRAN',
      'V',
      PaymentEventType.IPN,
    );

    expect(result.outcome).toBe('unknown_tran');
  });

  it('re-validates a success redirect server-side and marks paid', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockValidate(validResponse(o));

    const result = await payments.handleSuccessRedirect({
      tran_id: o.tranId,
      val_id: 'V',
      status: 'VALID',
    });

    expect(result.outcome).toBe('paid');
    await expectState(o, {
      order: 'PAID',
      payment: 'PAID',
      reservation: 'COMMITTED',
      stock: 0,
    });
  });

  it('fails and restocks on fail redirect', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);

    const result = await payments.handleFailRedirect({ tran_id: o.tranId });

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('cancels and restocks on cancel redirect', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);

    const result = await payments.handleCancelRedirect({ tran_id: o.tranId });

    expect(result.outcome).toBe('cancelled');
    await expectState(o, {
      order: 'CANCELLED',
      payment: 'CANCELLED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('fails and restocks on failed IPN', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);

    const result = await payments.handleIpn({
      tran_id: o.tranId,
      val_id: 'V',
      status: 'FAILED',
    });

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });
});
