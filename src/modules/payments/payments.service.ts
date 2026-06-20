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
import {
  SslcommerzService,
  SslcommerzValidationResponse,
} from './sslcommerz.service';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sslcommerz: SslcommerzService,
    private readonly inventory: InventoryService,
    private readonly jobs: JobsService,
  ) {}

  /** Create a gateway session for an order; returns GatewayPageURL or null. */
  async createPaymentSession(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    const payment = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    if (!order || !payment) return null;

    const resp = await this.sslcommerz.createSession(order, payment.tranId);
    await this.recordEvent({
      paymentId: payment.id,
      orderId,
      tranId: payment.tranId,
      type: PaymentEventType.SESSION_CREATED,
      payload: resp,
    });

    if (resp.status === 'SUCCESS' && resp.GatewayPageURL) {
      await this.prisma.$transaction([
        this.prisma.sslcommerzSession.create({
          data: {
            orderId,
            tranId: payment.tranId,
            sessionkey: resp.sessionkey ?? null,
            gatewayPageURL: resp.GatewayPageURL,
            status: resp.status,
            rawResponse: resp as Prisma.InputJsonValue,
          },
        }),
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SESSION_CREATED,
            gatewayPageURL: resp.GatewayPageURL,
          },
        }),
      ]);
      return resp.GatewayPageURL;
    }
    return null;
  }

  /** IPN listener entrypoint. Always records the raw event, then acts on it. */
  async handleIpn(body: Record<string, string>): Promise<ProcessResult> {
    const tranId = body.tran_id;
    const valId = body.val_id;
    const status = (body.status ?? '').toUpperCase();

    await this.recordEvent({
      tranId,
      type: PaymentEventType.IPN,
      payload: body,
    });

    if (status === 'VALID' || status === 'VALIDATED') {
      return this.processValidation(tranId, valId, PaymentEventType.IPN);
    }
    if (status === 'FAILED') return this.markTerminalByTran(tranId, 'fail');
    if (status === 'CANCELLED') return this.markTerminalByTran(tranId, 'cancel');
    return { outcome: 'unknown_tran' };
  }

  /** Browser success return — re-validate server-side, never trust the redirect. */
  async handleSuccessRedirect(body: Record<string, string>): Promise<ProcessResult> {
    await this.recordEvent({
      tranId: body.tran_id,
      type: PaymentEventType.SUCCESS_REDIRECT,
      payload: body,
    });
    return this.processValidation(body.tran_id, body.val_id, PaymentEventType.SUCCESS_REDIRECT);
  }

  async handleFailRedirect(body: Record<string, string>): Promise<ProcessResult> {
    await this.recordEvent({
      tranId: body.tran_id,
      type: PaymentEventType.FAIL_REDIRECT,
      payload: body,
    });
    return this.markTerminalByTran(body.tran_id, 'fail');
  }

  async handleCancelRedirect(body: Record<string, string>): Promise<ProcessResult> {
    await this.recordEvent({
      tranId: body.tran_id,
      type: PaymentEventType.CANCEL_REDIRECT,
      payload: body,
    });
    return this.markTerminalByTran(body.tran_id, 'cancel');
  }

  /**
   * The trust boundary. Loads the local payment, calls the Validation API, and
   * applies the verification rules. Idempotent: terminal payments short-circuit,
   * so duplicate IPN/redirects never double-pay or double-deduct stock.
   */
  async processValidation(
    tranId: string,
    valId: string,
    source: PaymentEventType,
  ): Promise<ProcessResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { tranId },
      include: { order: true },
    });
    if (!payment) {
      await this.recordEvent({
        tranId,
        type: PaymentEventType.VALIDATION,
        payload: { error: 'unknown tran_id', valId, source },
        signatureValid: false,
      });
      return { outcome: 'unknown_tran' };
    }

    // Idempotency guard — do NOT re-validate or re-commit terminal payments.
    if (payment.status === PaymentStatus.PAID) {
      return { outcome: 'already_paid', orderNumber: payment.order.orderNumber };
    }
    if (payment.status === PaymentStatus.PAYMENT_REVIEW) {
      return { outcome: 'already_review', orderNumber: payment.order.orderNumber };
    }

    const v = await this.sslcommerz.validate(valId);
    const check = this.verify(payment.tranId, payment.amount, payment.currency, v);
    await this.recordEvent({
      paymentId: payment.id,
      orderId: payment.orderId,
      tranId,
      type: PaymentEventType.VALIDATION,
      payload: v,
      signatureValid: check.ok,
      processed: true,
    });

    if (!check.ok) {
      if (check.reason === 'status_invalid' || check.reason === 'tran_id_mismatch') {
        await this.markTerminal(payment.id, payment.orderId, 'fail', v);
        return { outcome: 'failed', orderNumber: payment.order.orderNumber };
      }
      // amount/currency/store mismatch → suspicious, hold for a human.
      await this.markReview(payment.id, payment.orderId, v);
      return { outcome: 'review', orderNumber: payment.order.orderNumber };
    }

    if (this.toInt(v.risk_level) === 1) {
      await this.markReview(payment.id, payment.orderId, v);
      return { outcome: 'review', orderNumber: payment.order.orderNumber };
    }

    await this.markPaid(payment.id, payment.orderId, v);
    return { outcome: 'paid', orderNumber: payment.order.orderNumber };
  }

  // ── verification rules ──────────────────────────────────────────────────

  private verify(
    expectedTranId: string,
    expectedAmount: Prisma.Decimal,
    expectedCurrency: string,
    v: SslcommerzValidationResponse,
  ): { ok: boolean; reason?: string } {
    const status = (v.status ?? '').toUpperCase();
    if (status !== 'VALID' && status !== 'VALIDATED') {
      return { ok: false, reason: 'status_invalid' };
    }
    if (v.tran_id !== expectedTranId) {
      return { ok: false, reason: 'tran_id_mismatch' };
    }
    if ((v.currency ?? '').toUpperCase() !== expectedCurrency.toUpperCase()) {
      return { ok: false, reason: 'currency_mismatch' };
    }
    if (!this.amountsEqual(v.amount, expectedAmount)) {
      return { ok: false, reason: 'amount_mismatch' };
    }
    if (
      v.store_id &&
      process.env.SSLCOMMERZ_STORE_ID &&
      v.store_id !== process.env.SSLCOMMERZ_STORE_ID
    ) {
      return { ok: false, reason: 'store_id_mismatch' };
    }
    return { ok: true };
  }

  private amountsEqual(raw: unknown, expected: Prisma.Decimal): boolean {
    const n = Number(raw);
    if (Number.isNaN(n)) return false;
    return Math.abs(n - expected.toNumber()) < 0.01;
  }

  private toInt(raw: unknown): number | null {
    const n = parseInt(String(raw ?? ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  // ── state transitions (all atomic + idempotent) ─────────────────────────

  private async markPaid(
    paymentId: string,
    orderId: string,
    v: SslcommerzValidationResponse,
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
          valId: v.val_id ?? null,
          bankTranId: v.bank_tran_id ?? null,
          cardType: v.card_type ?? null,
          cardIssuer: v.card_issuer ?? null,
          riskLevel: this.toInt(v.risk_level),
          riskTitle: v.risk_title ?? null,
          storeAmount: v.store_amount ? new Prisma.Decimal(v.store_amount) : null,
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
    }
  }

  private async markReview(
    paymentId: string,
    orderId: string,
    v: SslcommerzValidationResponse,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: PaymentStatus.PAID } },
        data: {
          status: PaymentStatus.PAYMENT_REVIEW,
          valId: v.val_id ?? null,
          riskLevel: this.toInt(v.risk_level),
          riskTitle: v.risk_title ?? null,
          storeAmount: v.store_amount ? new Prisma.Decimal(v.store_amount) : null,
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

  private async markTerminalByTran(
    tranId: string,
    reason: 'fail' | 'cancel',
  ): Promise<ProcessResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { tranId },
      include: { order: true },
    });
    if (!payment) return { outcome: 'unknown_tran' };
    if (payment.status === PaymentStatus.PAID) {
      return { outcome: 'already_paid', orderNumber: payment.order.orderNumber };
    }
    await this.markTerminal(payment.id, payment.orderId, reason);
    return {
      outcome: reason === 'cancel' ? 'cancelled' : 'failed',
      orderNumber: payment.order.orderNumber,
    };
  }

  private async markTerminal(
    paymentId: string,
    orderId: string,
    reason: 'fail' | 'cancel',
    v?: SslcommerzValidationResponse,
  ): Promise<void> {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { not: PaymentStatus.PAID } },
      data: {
        status:
          reason === 'cancel'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.FAILED,
        valId: v?.val_id ?? undefined,
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
