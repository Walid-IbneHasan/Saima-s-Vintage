import { NestExpressApplication } from '@nestjs/platform-express';
import { BkashService } from '../src/modules/payments/bkash.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPendingOrder, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('bKash payments matrix (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;
  let bkash: BkashService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    payments = app.get(PaymentsService);
    bkash = app.get(BkashService);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  type Pending = {
    orderId: string;
    tranId: string;
    bkashPaymentID: string;
    amount: string;
    variantId: string;
  };

  function completed(o: Pending, over: Record<string, unknown> = {}) {
    return {
      statusCode: '0000',
      statusMessage: 'Successful',
      paymentID: o.bkashPaymentID,
      trxID: 'TRX-OK',
      transactionStatus: 'Completed',
      amount: o.amount,
      currency: 'BDT',
      merchantInvoiceNumber: o.tranId,
      customerMsisdn: '01770618576',
      ...over,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mockExecute(resp: Record<string, unknown>) {
    return jest.spyOn(bkash, 'executePayment').mockResolvedValue(resp as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mockQuery(resp: Record<string, unknown>) {
    return jest.spyOn(bkash, 'queryPayment').mockResolvedValue(resp as any);
  }

  async function expectState(
    o: Pending,
    expected: { order: string; payment: string; reservation: string; stock: number },
  ) {
    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe(expected.order);

    const payment = await prisma.payment.findUnique({ where: { tranId: o.tranId } });
    expect(payment?.status).toBe(expected.payment);

    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: o.orderId },
    });
    expect(reservation?.status).toBe(expected.reservation);

    const variant = await prisma.productVariant.findUnique({ where: { id: o.variantId } });
    expect(variant?.stock).toBe(expected.stock);
  }

  it('fails and restocks when the payment never completes', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockExecute({ statusCode: '2062', transactionStatus: 'Initiated' });
    mockQuery({ statusCode: '2062', transactionStatus: 'Failed' });

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('fails and restocks when the captured invoice does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockExecute(completed(o, { merchantInvoiceNumber: 'WRONG-INVOICE' }));

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('holds for review when the captured currency does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockExecute(completed(o, { currency: 'USD' }));

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');

    expect(result.outcome).toBe('review');
    await expectState(o, {
      order: 'PAYMENT_REVIEW',
      payment: 'PAYMENT_REVIEW',
      reservation: 'ACTIVE',
      stock: 0,
    });
  });

  it('holds for review when the captured amount does not match', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockExecute(completed(o, { amount: '1' }));

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');

    expect(result.outcome).toBe('review');
    await expectState(o, {
      order: 'PAYMENT_REVIEW',
      payment: 'PAYMENT_REVIEW',
      reservation: 'ACTIVE',
      stock: 0,
    });
  });

  it('returns unknown_tran when the callback paymentID has no matching payment', async () => {
    await resetDb(prisma);

    const result = await payments.handleCallback('NO-SUCH-PAYMENT', 'success');

    expect(result.outcome).toBe('unknown_tran');
  });

  it('cancels and restocks on a cancel callback', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);

    const result = await payments.handleCallback(o.bkashPaymentID, 'cancel');

    expect(result.outcome).toBe('cancelled');
    await expectState(o, {
      order: 'CANCELLED',
      payment: 'CANCELLED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('fails and restocks on a failure callback', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);

    const result = await payments.handleCallback(o.bkashPaymentID, 'failure');

    expect(result.outcome).toBe('failed');
    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('reconcile settles a stuck payment that bKash reports as Completed', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockQuery(completed(o));

    // Negative window so the just-created row is always past the cutoff.
    const res = await payments.reconcile(-1);
    expect(res.paid).toBe(1);

    await expectState(o, {
      order: 'PAID',
      payment: 'PAID',
      reservation: 'COMMITTED',
      stock: 0,
    });
  });

  it('reconcile fails+restocks a stuck payment that bKash reports as Failed', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockQuery({ statusCode: '2062', transactionStatus: 'Failed' });

    const res = await payments.reconcile(-1);
    expect(res.failed).toBe(1);

    await expectState(o, {
      order: 'FAILED',
      payment: 'FAILED',
      reservation: 'RELEASED',
      stock: 1,
    });
  });

  it('refunds a captured payment: order/payment REFUNDED and items restocked', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    mockExecute(completed(o));
    await payments.handleCallback(o.bkashPaymentID, 'success');
    await expectState(o, {
      order: 'PAID',
      payment: 'PAID',
      reservation: 'COMMITTED',
      stock: 0,
    });

    jest.spyOn(bkash, 'refund').mockResolvedValue({
      statusCode: '0000',
      statusMessage: 'Successful',
      refundTrxID: 'REF-1',
      originalTrxID: 'TRX-OK',
      transactionStatus: 'Completed',
      amount: o.amount,
      currency: 'BDT',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await payments.refund(o.orderId);
    expect(result.ok).toBe(true);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('REFUNDED');
    const payment = await prisma.payment.findUnique({ where: { tranId: o.tranId } });
    expect(payment?.status).toBe('REFUNDED');
    const variant = await prisma.productVariant.findUnique({ where: { id: o.variantId } });
    expect(variant?.stock).toBe(1); // restocked
  });
});
