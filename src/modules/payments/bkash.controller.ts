import { Controller, Get, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PaymentsService } from './payments.service';

// CSRF-exempt by design (the `/payments/*` prefix is skipped) — bKash returns the
// customer here via a browser GET redirect with `paymentID` and `status`. Trust
// comes from the server-to-server Execute/Query call, not from this request.
@Controller('payments/bkash')
export class BkashController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  @SkipThrottle()
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    // bKash returns ?paymentID=...&status=... — tolerate either casing of the id.
    const paymentID = query.paymentID ?? query.paymentId ?? '';
    const status = (query.status ?? '').toLowerCase();
    const result = await this.payments.handleCallback(paymentID, status);
    if (result.orderNumber) {
      res.redirect(`/checkout/complete/${result.orderNumber}`);
    } else {
      res.redirect('/cart');
    }
  }
}
