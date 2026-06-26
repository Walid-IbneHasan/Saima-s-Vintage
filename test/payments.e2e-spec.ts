import { NestExpressApplication } from '@nestjs/platform-express';
import { BkashService } from '../src/modules/payments/bkash.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPendingOrder, resetDb } from './helpers/factories';
import { createTestApp } from './helpers/test-app';

describe('bKash payments (e2e)', () => {
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

  function completedExecute(o: { tranId: string; bkashPaymentID: string; amount: string }) {
    return {
      statusCode: '0000',
      statusMessage: 'Successful',
      paymentID: o.bkashPaymentID,
      trxID: 'TRX123456',
      transactionStatus: 'Completed',
      amount: o.amount,
      currency: 'BDT',
      merchantInvoiceNumber: o.tranId,
      customerMsisdn: '01770618576',
    };
  }

  it('creates a bKash payment and persists the paymentID + redirect URL', async () => {
    await resetDb(prisma);
    const { orderId, tranId } = await createPendingOrder(prisma);
    jest.spyOn(bkash, 'createPayment').mockResolvedValue({
      statusCode: '0000',
      statusMessage: 'Successful',
      paymentID: 'PAY-NEW-1',
      bkashURL: 'https://sandbox.payment.bkash.com/?paymentID=PAY-NEW-1&hash=abc',
      transactionStatus: 'Initiated',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const url = await payments.createPaymentSession(orderId);
    expect(url).toBe('https://sandbox.payment.bkash.com/?paymentID=PAY-NEW-1&hash=abc');

    const payment = await prisma.payment.findUnique({ where: { tranId } });
    expect(payment?.status).toBe('SESSION_CREATED');
    expect(payment?.bkashPaymentID).toBe('PAY-NEW-1');
    expect(payment?.gatewayPageURL).toContain('bkash.com');
  });

  it('executes on a success callback and marks the order PAID + commits the reservation', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    const exec = jest
      .spyOn(bkash, 'executePayment')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(completedExecute(o) as any);

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');
    expect(result.outcome).toBe('paid');
    expect(exec).toHaveBeenCalledWith(o.bkashPaymentID);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('PAID');
    expect(order?.paidAt).toBeTruthy();

    const payment = await prisma.payment.findUnique({ where: { tranId: o.tranId } });
    expect(payment?.status).toBe('PAID');
    expect(payment?.bkashTrxID).toBe('TRX123456');
    expect(payment?.payerAccount).toBe('01770618576');

    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: o.orderId },
    });
    expect(reservation?.status).toBe('COMMITTED');
  });

  it('is idempotent — a duplicate success callback does not re-execute or double-process', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    const exec = jest
      .spyOn(bkash, 'executePayment')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(completedExecute(o) as any);

    const first = await payments.handleCallback(o.bkashPaymentID, 'success');
    const second = await payments.handleCallback(o.bkashPaymentID, 'success');

    expect(first.outcome).toBe('paid');
    expect(second.outcome).toBe('already_paid');
    expect(exec).toHaveBeenCalledTimes(1); // 2nd call short-circuits before executing

    const paidPayments = await prisma.payment.count({
      where: { orderId: o.orderId, status: 'PAID' },
    });
    expect(paidPayments).toBe(1);
    const committed = await prisma.inventoryReservation.count({
      where: { orderId: o.orderId, status: 'COMMITTED' },
    });
    expect(committed).toBe(1);
  });

  it('settles via Query when Execute reports "already executed" (timeout/duplicate)', async () => {
    await resetDb(prisma);
    const o = await createPendingOrder(prisma);
    // Execute answers a non-0000 "already completed" code...
    jest.spyOn(bkash, 'executePayment').mockResolvedValue({
      statusCode: '2029',
      statusMessage: 'The payment has already been completed',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // ...but Query is authoritative and shows the charge went through.
    const query = jest
      .spyOn(bkash, 'queryPayment')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(completedExecute(o) as any);

    const result = await payments.handleCallback(o.bkashPaymentID, 'success');
    expect(result.outcome).toBe('paid');
    expect(query).toHaveBeenCalledWith(o.bkashPaymentID);

    const order = await prisma.order.findUnique({ where: { id: o.orderId } });
    expect(order?.status).toBe('PAID');
  });
});
