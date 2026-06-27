import { Injectable, Logger } from '@nestjs/common';
import {
  OrderStatus,
  PaymentEventType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { JobsService } from '../jobs/jobs.service';
import { BkashExecuteResponse, BkashService } from './bkash.service';

export type PaymentOutcome =
  | 'paid'
  | 'review'
  | 'failed'
  | 'cancelled'
  | 'already_paid'
  | 'already_review'
  | 'unknown_tran';

export interface ProcessResult {
  outcome: PaymentOutcome;
  orderNumber?: string;
}

// A payment row loaded together with its order (the only relation we need).
type PaymentWithOrder = Prisma.PaymentGetPayload<{ include: { order: true } }>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bkash: BkashService,
    private readonly inventory: InventoryService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Create a bKash hosted-checkout payment for an order; returns the `bkashURL`
   * to redirect the customer to, or null if creation failed (order stays
   * AWAITING_PAYMENT). We persist bKash's `paymentID` so the redirect callback —
   * which only echoes that id — can be correlated back to this payment.
   */
  async createPaymentSession(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    const payment = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    if (!order || !payment) return null;

    const resp = await this.bkash.createPayment(order, payment.tranId);
    await this.recordEvent({
      paymentId: payment.id,
      orderId,
      tranId: payment.tranId,
      type: PaymentEventType.SESSION_CREATED,
      payload: resp,
    });

    if (resp.statusCode === '0000' && resp.bkashURL && resp.paymentID) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SESSION_CREATED,
          bkashPaymentID: resp.paymentID,
          gatewayPageURL: resp.bkashURL,
        },
      });
      return resp.bkashURL;
    }
    this.logger.warn(
      `bKash create failed for ${order.orderNumber}: ${resp.statusCode ?? '?'} ${resp.statusMessage ?? ''}`,
    );
    return null;
  }

  /**
   * Cash on Delivery confirmation. The order is already PROCESSING with a
   * PENDING `cod` payment (created in checkout); here we just send the order
   * confirmation email. Cash is captured later when an admin marks the order
   * delivered.
   */
  async confirmCodOrder(orderId: string): Promise<void> {
    await this.jobs.enqueue('email.order_confirmation', { orderId });
    await this.jobs.enqueue('email.new_order_store', { orderId });
  }

  /**
   * Browser return from the bKash page (GET /payments/bkash/callback?paymentID&status).
   * Never trust `status` alone — on "success" we Execute server-side (the trust
   * boundary). Idempotent: terminal payments short-circuit.
   */
  async handleCallback(paymentID: string, status: string): Promise<ProcessResult> {
    if (!paymentID) return { outcome: 'unknown_tran' };

    const payment = await this.prisma.payment.findUnique({
      where: { bkashPaymentID: paymentID },
      include: { order: true },
    });
    if (!payment) {
      await this.recordEvent({
        type: this.callbackEventType(status),
        payload: { paymentID, status, error: 'unknown paymentID' },
        signatureValid: false,
      });
      return { outcome: 'unknown_tran' };
    }

    await this.recordEvent({
      paymentId: payment.id,
      orderId: payment.orderId,
      tranId: payment.tranId,
      type: this.callbackEventType(status),
      payload: { paymentID, status },
    });

    // Idempotency — duplicate callbacks never re-execute or double-process.
    if (payment.status === PaymentStatus.PAID) {
      return { outcome: 'already_paid', orderNumber: payment.order.orderNumber };
    }
    if (payment.status === PaymentStatus.PAYMENT_REVIEW) {
      return { outcome: 'already_review', orderNumber: payment.order.orderNumber };
    }

    if (status === 'success') {
      const exec = await this.bkash.executePayment(paymentID);
      return this.settle(payment, exec);
    }

    const reason = status === 'cancel' ? 'cancel' : 'fail';
    await this.markTerminal(payment.id, payment.orderId, reason);
    return {
      outcome: reason === 'cancel' ? 'cancelled' : 'failed',
      orderNumber: payment.order.orderNumber,
    };
  }

  /**
   * The trust boundary. Given an Execute (or Query) response, settle the payment.
   * If the response is not a clean "Completed", re-Query bKash — that catches the
   * "already executed" / Execute-timeout cases where the charge actually went
   * through. Records the authoritative response as a VALIDATION event.
   */
  private async settle(
    payment: PaymentWithOrder,
    response: BkashExecuteResponse,
  ): Promise<ProcessResult> {
    let r = response;
    if (!this.isCompleted(r) && payment.bkashPaymentID) {
      r = await this.bkash.queryPayment(payment.bkashPaymentID);
    }

    const check = this.verify(payment, r);
    await this.recordEvent({
      paymentId: payment.id,
      orderId: payment.orderId,
      tranId: payment.tranId,
      type: PaymentEventType.VALIDATION,
      payload: r,
      signatureValid: check.ok,
      processed: true,
    });

    if (!check.ok) {
      // Amount/currency anomalies are suspicious but the money may have moved —
      // hold for a human. Anything else (not completed, wrong invoice) is a hard fail.
      if (check.reason === 'amount_mismatch' || check.reason === 'currency_mismatch') {
        await this.markReview(payment.id, payment.orderId, r);
        return { outcome: 'review', orderNumber: payment.order.orderNumber };
      }
      await this.markTerminal(payment.id, payment.orderId, 'fail', r);
      return { outcome: 'failed', orderNumber: payment.order.orderNumber };
    }

    await this.markPaid(payment.id, payment.orderId, r);
    return { outcome: 'paid', orderNumber: payment.order.orderNumber };
  }

  /**
   * Reconcile payments stuck at SESSION_CREATED (customer left the bKash page, or
   * Execute/callback never completed). bKash has NO webhook, so a cPanel cron
   * drives this. Only settles on a confirmed "Completed" Query; never Executes an
   * Initiated payment. Idempotent.
   */
  async reconcile(
    olderThanMinutes = 15,
  ): Promise<{ reconciled: number; paid: number; failed: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
    const pending = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SESSION_CREATED,
        createdAt: { lt: cutoff },
        bkashPaymentID: { not: null },
      },
      include: { order: true },
      take: 100,
    });

    let paid = 0;
    let failed = 0;
    for (const payment of pending) {
      try {
        const q = await this.bkash.queryPayment(payment.bkashPaymentID as string);
        const ts = (q.transactionStatus ?? '').toLowerCase();
        if (ts === 'completed') {
          const r = await this.settle(payment, q);
          if (r.outcome === 'paid') paid += 1;
        } else if (ts === 'cancelled' || ts === 'failed') {
          await this.recordEvent({
            paymentId: payment.id,
            orderId: payment.orderId,
            tranId: payment.tranId,
            type: PaymentEventType.VALIDATION,
            payload: q,
            processed: true,
          });
          await this.markTerminal(payment.id, payment.orderId, 'fail', q);
          failed += 1;
        }
        // 'initiated' → customer never paid; order-TTL expiry handles restock.
      } catch (e) {
        this.logger.warn(
          `reconcile failed for ${payment.bkashPaymentID}: ${(e as Error).message}`,
        );
      }
    }
    if (paid || failed) {
      this.logger.log(`Reconciled bKash payments: ${paid} paid, ${failed} failed`);
    }
    return { reconciled: paid + failed, paid, failed };
  }

  /**
   * Admin-initiated full refund of an order's captured bKash payment. On success:
   * payment → REFUNDED, order → REFUNDED, stock restocked.
   */
  async refund(
    orderId: string,
    opts?: { reason?: string },
  ): Promise<{ ok: boolean; message: string }> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.PAID },
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
    if (!payment) return { ok: false, message: 'No captured payment to refund.' };
    if (!payment.bkashPaymentID || !payment.bkashTrxID) {
      return { ok: false, message: 'Payment is missing bKash identifiers.' };
    }

    const resp = await this.bkash.refund({
      paymentID: payment.bkashPaymentID,
      trxID: payment.bkashTrxID,
      amount: payment.amount.toFixed(2),
      sku: payment.order.orderNumber,
      reason: opts?.reason ?? 'Admin refund',
    });
    await this.recordEvent({
      paymentId: payment.id,
      orderId,
      tranId: payment.tranId,
      type: PaymentEventType.REFUND,
      payload: resp,
      signatureValid: resp.statusCode === '0000',
      processed: true,
    });

    const ok =
      resp.statusCode === '0000' &&
      (resp.transactionStatus ?? '').toLowerCase() === 'completed';
    if (!ok) {
      return { ok: false, message: resp.statusMessage ?? 'Refund failed at bKash.' };
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PAID },
        data: { status: PaymentStatus.REFUNDED },
      });
      if (c.count === 0) return false;
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.REFUNDED },
      });
      return true;
    });
    if (claimed) await this.inventory.restockOrder(orderId, 'refund');
    return { ok: true, message: 'Refund completed.' };
  }

  // ── verification rules ──────────────────────────────────────────────────

  private isCompleted(r: BkashExecuteResponse): boolean {
    return (
      r.statusCode === '0000' &&
      (r.transactionStatus ?? '').toLowerCase() === 'completed'
    );
  }

  private verify(
    payment: PaymentWithOrder,
    r: BkashExecuteResponse,
  ): { ok: boolean; reason?: string } {
    if ((r.transactionStatus ?? '').toLowerCase() !== 'completed') {
      return { ok: false, reason: 'status_invalid' };
    }
    if (r.statusCode && r.statusCode !== '0000') {
      return { ok: false, reason: 'status_invalid' };
    }
    // Anti-replay: the captured invoice must be the one we created.
    if (r.merchantInvoiceNumber && r.merchantInvoiceNumber !== payment.tranId) {
      return { ok: false, reason: 'invoice_mismatch' };
    }
    if ((r.currency ?? 'BDT').toUpperCase() !== payment.currency.toUpperCase()) {
      return { ok: false, reason: 'currency_mismatch' };
    }
    if (!this.amountsEqual(r.amount, payment.amount)) {
      return { ok: false, reason: 'amount_mismatch' };
    }
    return { ok: true };
  }

  private amountsEqual(raw: unknown, expected: Prisma.Decimal): boolean {
    const n = Number(raw);
    if (Number.isNaN(n)) return false;
    return Math.abs(n - expected.toNumber()) < 0.01;
  }

  private callbackEventType(status: string): PaymentEventType {
    if (status === 'success') return PaymentEventType.SUCCESS_REDIRECT;
    if (status === 'cancel') return PaymentEventType.CANCEL_REDIRECT;
    return PaymentEventType.FAIL_REDIRECT;
  }

  // ── state transitions (all atomic + idempotent) ─────────────────────────

  private async markPaid(
    paymentId: string,
    orderId: string,
    v: BkashExecuteResponse,
  ): Promise<void> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: {
            notIn: [
              PaymentStatus.PAID,
              PaymentStatus.REFUNDED,
              PaymentStatus.PARTIALLY_REFUNDED,
            ],
          },
        },
        data: {
          status: PaymentStatus.PAID,
          bkashTrxID: v.trxID ?? null,
          payerAccount: v.customerMsisdn ?? null,
          validatedAt: new Date(),
        },
      });
      if (c.count === 0) return false; // already claimed by a concurrent call
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID, paidAt: new Date() },
      });
      await this.inventory.commitReservations(orderId, tx);
      return true;
    });

    // Enqueue the confirmation email only if THIS call won the claim (idempotent).
    if (claimed) {
      await this.jobs.enqueue('email.order_confirmation', { orderId });
      await this.jobs.enqueue('email.new_order_store', { orderId });
    }
  }

  private async markReview(
    paymentId: string,
    orderId: string,
    v: BkashExecuteResponse,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: PaymentStatus.PAID } },
        data: {
          status: PaymentStatus.PAYMENT_REVIEW,
          bkashTrxID: v.trxID ?? undefined,
          payerAccount: v.customerMsisdn ?? undefined,
          validatedAt: new Date(),
        },
      });
      if (claimed.count === 0) return;
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAYMENT_REVIEW },
      });
      // Reservations stay ACTIVE — a human decides to fulfil or refund.
    });
  }

  private async markTerminal(
    paymentId: string,
    orderId: string,
    reason: 'fail' | 'cancel',
    v?: BkashExecuteResponse,
  ): Promise<void> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { not: PaymentStatus.PAID } },
      data: {
        status:
          reason === 'cancel'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.FAILED,
        bkashTrxID: v?.trxID ?? undefined,
      },
    });
    if (claimed.count === 0) return;
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status:
          reason === 'cancel' ? OrderStatus.CANCELLED : OrderStatus.FAILED,
      },
    });
    // Restock — idempotent, so duplicate fail/cancel callbacks are safe.
    await this.inventory.releaseReservations(orderId, reason);
  }

  private async recordEvent(e: {
    paymentId?: string;
    orderId?: string;
    tranId?: string;
    type: PaymentEventType;
    payload: unknown;
    signatureValid?: boolean;
    processed?: boolean;
  }): Promise<void> {
    await this.prisma.paymentEvent.create({
      data: {
        paymentId: e.paymentId,
        orderId: e.orderId,
        tranId: e.tranId,
        type: e.type,
        payload: e.payload as Prisma.InputJsonValue,
        signatureValid: e.signatureValid,
        processed: e.processed ?? false,
      },
    });
  }
}
