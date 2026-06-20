import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PaymentsService, ProcessResult } from './payments.service';

// CSRF-exempt by design (server-to-server / cross-site gateway callbacks) — the
// CSRF middleware skips /payments/*. Trust comes from the Validation API, not
// from these requests.
@Controller('payments/sslcommerz')
export class SslcommerzController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('success')
  async success(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.payments.handleSuccessRedirect(body);
    this.redirect(res, result);
  }

  @Post('fail')
  async fail(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.payments.handleFailRedirect(body);
    this.redirect(res, result);
  }

  @Post('cancel')
  async cancel(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.payments.handleCancelRedirect(body);
    this.redirect(res, result);
  }

  // SSLCOMMERZ requires a 200 here; processing is idempotent so retries are safe.
  @Post('ipn')
  @HttpCode(200)
  @SkipThrottle()
  async ipn(
    @Body() body: Record<string, string>,
  ): Promise<{ received: boolean; outcome: string }> {
    const result = await this.payments.handleIpn(body);
    return { received: true, outcome: result.outcome };
  }

  private redirect(res: Response, result: ProcessResult): void {
    if (result.orderNumber) {
      res.redirect(`/checkout/complete/${result.orderNumber}`);
    } else {
      res.redirect('/cart');
    }
  }
}
