import { Injectable, Logger } from '@nestjs/common';
import { Order } from '@prisma/client';

// ── Response shapes (only the fields we read; bKash returns more) ────────────

export interface BkashTokenResponse {
  statusCode?: string;
  statusMessage?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface BkashCreateResponse {
  statusCode?: string; // '0000' = success
  statusMessage?: string;
  paymentID?: string;
  bkashURL?: string; // hosted-checkout redirect target
  callbackURL?: string;
  successCallbackURL?: string;
  failureCallbackURL?: string;
  cancelledCallbackURL?: string;
  amount?: string;
  intent?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  transactionStatus?: string; // 'Initiated'
  [k: string]: unknown;
}

/** Shape of both Execute and Query (Payment Status) responses. */
export interface BkashExecuteResponse {
  statusCode?: string; // '0000' = success
  statusMessage?: string;
  paymentID?: string;
  payerReference?: string;
  customerMsisdn?: string; // masked payer wallet
  trxID?: string;
  transactionStatus?: string; // 'Initiated' | 'Completed' | 'Cancelled' | 'Failed'
  amount?: string;
  currency?: string;
  intent?: string;
  merchantInvoiceNumber?: string;
  paymentExecuteTime?: string;
  [k: string]: unknown;
}

export interface BkashRefundResponse {
  statusCode?: string;
  statusMessage?: string;
  originalTrxID?: string;
  refundTrxID?: string;
  transactionStatus?: string; // 'Completed'
  amount?: string;
  currency?: string;
  charge?: string;
  completedTime?: string;
  [k: string]: unknown;
}

/**
 * Thin HTTP client for bKash PGW Tokenized Checkout (v1.2.0-beta). No business
 * rules live here — PaymentsService decides what a response means. The id_token
 * is cached in-process and re-granted on expiry (each Passenger worker keeps its
 * own; grant is cheap and the token lasts ~1h).
 *
 * Credentials (app_key/app_secret/username/password) are read from env and stay
 * strictly server-side — they never reach the browser.
 */
@Injectable()
export class BkashService {
  private readonly logger = new Logger(BkashService.name);

  private token: { value: string; expiresAt: number } | null = null;

  private get isLive(): boolean {
    return process.env.BKASH_IS_LIVE === 'true';
  }
  private get appKey(): string {
    return process.env.BKASH_APP_KEY ?? '';
  }
  private get appSecret(): string {
    return process.env.BKASH_APP_SECRET ?? '';
  }
  private get username(): string {
    return process.env.BKASH_USERNAME ?? '';
  }
  private get password(): string {
    return process.env.BKASH_PASSWORD ?? '';
  }
  private get callbackUrl(): string {
    return process.env.BKASH_CALLBACK_URL ?? '';
  }
  private get baseUrl(): string {
    return this.isLive
      ? 'https://tokenized.pay.bka.sh/v1.2.0-beta'
      : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
  }

  /**
   * Grant (or reuse a cached) id_token. The Authorization header on subsequent
   * calls is the RAW token — bKash does NOT want a "Bearer " prefix.
   */
  async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const res = await fetch(`${this.baseUrl}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        username: this.username,
        password: this.password,
      },
      body: JSON.stringify({
        app_key: this.appKey,
        app_secret: this.appSecret,
      }),
    });
    const data = (await res.json()) as BkashTokenResponse;
    if (!data.id_token) {
      this.logger.error(
        `bKash token grant failed: ${data.statusCode ?? '?'} ${data.statusMessage ?? ''}`,
      );
      throw new Error('bKash token grant failed');
    }
    // Refresh ~60s before the real expiry to avoid edge-of-window 401s.
    const ttlMs = (data.expires_in ?? 3600) * 1000 - 60_000;
    this.token = { value: data.id_token, expiresAt: Date.now() + ttlMs };
    return this.token.value;
  }

  /** Create a hosted-checkout payment. `ref` is our tranId (merchantInvoiceNumber). */
  async createPayment(order: Order, ref: string): Promise<BkashCreateResponse> {
    return this.post<BkashCreateResponse>('/tokenized/checkout/create', {
      mode: '0011', // tokenized checkout-URL, single payment
      payerReference: order.shipPhone || ref,
      callbackURL: this.callbackUrl,
      amount: order.grandTotal.toFixed(2),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: ref,
    });
  }

  /** Capture a payment after the customer returns from the bKash page. */
  async executePayment(paymentID: string): Promise<BkashExecuteResponse> {
    return this.post<BkashExecuteResponse>('/tokenized/checkout/execute', {
      paymentID,
    });
  }

  /** Server-to-server status query — used for reconciliation and as the
   * source of truth when Execute times out or reports "already executed". */
  async queryPayment(paymentID: string): Promise<BkashExecuteResponse> {
    return this.post<BkashExecuteResponse>('/tokenized/checkout/payment/status', {
      paymentID,
    });
  }

  async refund(args: {
    paymentID: string;
    trxID: string;
    amount: string;
    sku: string;
    reason: string;
  }): Promise<BkashRefundResponse> {
    return this.post<BkashRefundResponse>('/tokenized/checkout/payment/refund', {
      paymentID: args.paymentID,
      trxID: args.trxID,
      amount: args.amount,
      sku: args.sku,
      reason: args.reason,
    });
  }

  /**
   * Authenticated JSON POST with a one-shot token refresh: if bKash answers
   * with an auth error (401 or statusCode 2001/2003 "invalid token"), we
   * re-grant once and retry.
   */
  private async post<T extends { statusCode?: string }>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const send = async (token: string): Promise<{ res: Response; data: T }> => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: token,
          'X-APP-Key': this.appKey,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as T;
      return { res, data };
    };

    let token = await this.getToken();
    let { res, data } = await send(token);
    if (res.status === 401 || this.isAuthError(data.statusCode)) {
      token = await this.getToken(true);
      ({ res, data } = await send(token));
    }
    return data;
  }

  private isAuthError(statusCode?: string): boolean {
    return statusCode === '2001' || statusCode === '2003' || statusCode === '2056';
  }
}
