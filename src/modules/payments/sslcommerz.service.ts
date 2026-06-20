import { Injectable, Logger } from '@nestjs/common';
import { Order } from '@prisma/client';

export interface SslcommerzSessionResponse {
  status?: string; // SUCCESS | FAILED
  sessionkey?: string;
  GatewayPageURL?: string;
  failedreason?: string;
  [k: string]: unknown;
}

export interface SslcommerzValidationResponse {
  status?: string; // VALID | VALIDATED | INVALID_TRANSACTION
  tran_id?: string;
  val_id?: string;
  amount?: string;
  store_amount?: string;
  currency?: string;
  bank_tran_id?: string;
  card_type?: string;
  card_issuer?: string;
  risk_level?: string;
  risk_title?: string;
  store_id?: string;
  [k: string]: unknown;
}

/**
 * Thin HTTP client for SSLCOMMERZ. No business rules live here — PaymentsService
 * decides what a response means. Kept small so it can be mocked in tests.
 */
@Injectable()
export class SslcommerzService {
  private readonly logger = new Logger(SslcommerzService.name);

  private get isLive(): boolean {
    return process.env.SSLCOMMERZ_IS_LIVE === 'true';
  }
  private get storeId(): string {
    return process.env.SSLCOMMERZ_STORE_ID ?? '';
  }
  private get storePassword(): string {
    return process.env.SSLCOMMERZ_STORE_PASSWORD ?? '';
  }
  private get baseUrl(): string {
    return this.isLive
      ? 'https://securepay.sslcommerz.com'
      : 'https://sandbox.sslcommerz.com';
  }

  /** Create a hosted-checkout session. Returns the gateway response verbatim. */
  async createSession(
    order: Order,
    tranId: string,
  ): Promise<SslcommerzSessionResponse> {
    const body = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: order.grandTotal.toString(),
      currency: order.currency,
      tran_id: tranId,
      success_url: process.env.SSLCOMMERZ_SUCCESS_URL ?? '',
      fail_url: process.env.SSLCOMMERZ_FAIL_URL ?? '',
      cancel_url: process.env.SSLCOMMERZ_CANCEL_URL ?? '',
      ipn_url: process.env.SSLCOMMERZ_IPN_URL ?? '',
      cus_name: order.shipName,
      cus_email: order.email,
      cus_add1: order.shipLine1,
      cus_city: order.shipCity,
      cus_postcode: order.shipPostalCode ?? '',
      cus_country: order.shipCountry,
      cus_phone: order.shipPhone,
      shipping_method: 'Courier',
      ship_name: order.shipName,
      ship_add1: order.shipLine1,
      ship_city: order.shipCity,
      ship_country: order.shipCountry,
      num_of_item: '1',
      product_name: `Order ${order.orderNumber}`,
      product_category: 'Vintage',
      product_profile: 'general',
    });

    const res = await fetch(`${this.baseUrl}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return (await res.json()) as SslcommerzSessionResponse;
  }

  /**
   * Server-to-server Order Validation. This is the ONLY source of truth for
   * "was this paid" — never the browser redirect.
   */
  async validate(valId: string): Promise<SslcommerzValidationResponse> {
    const url = new URL(`${this.baseUrl}/validator/api/validationserverAPI.php`);
    url.searchParams.set('val_id', valId);
    url.searchParams.set('store_id', this.storeId);
    url.searchParams.set('store_passwd', this.storePassword);
    url.searchParams.set('format', 'json');

    const res = await fetch(url, { method: 'GET' });
    return (await res.json()) as SslcommerzValidationResponse;
  }
}
