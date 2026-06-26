import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Renders friendly error pages for HTML requests and JSON for API/XHR requests.
 * Never leaks stack traces or internal messages for 5xx in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  constructor(private readonly isProd: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${req.method} ${req.originalUrl} → ${status} ${rawMessage}`);
    }

    // Unauthenticated admin requests → redirect to the admin login page. Clear
    // the (stale/expired) cookie first so the login page doesn't bounce straight
    // back here — otherwise an invalid-but-present cookie loops indefinitely
    // (ERR_TOO_MANY_REDIRECTS).
    if (
      status === HttpStatus.UNAUTHORIZED &&
      req.originalUrl.startsWith('/admin') &&
      !req.originalUrl.startsWith('/admin/login')
    ) {
      res.clearCookie('sv_admin', { path: '/' });
      res.redirect('/admin/login');
      return;
    }

    // Unauthenticated customer-account requests → redirect to the customer
    // login, clearing the stale cookie so /login doesn't redirect back (loop).
    if (
      status === HttpStatus.UNAUTHORIZED &&
      req.originalUrl.startsWith('/account')
    ) {
      res.clearCookie('sv_customer', { path: '/' });
      res.redirect('/login');
      return;
    }

    const safeMessage =
      this.isProd && status >= 500 ? 'Something went wrong.' : rawMessage;

    const wantsJson =
      req.xhr ||
      (req.headers.accept ?? '').includes('application/json') ||
      req.originalUrl.startsWith('/health') ||
      req.originalUrl.startsWith('/payments/') ||
      req.originalUrl.startsWith('/internal/');

    if (wantsJson) {
      res.status(status).json({ statusCode: status, message: safeMessage });
      return;
    }

    try {
      res.status(status).render('pages/error', {
        title: `Error ${status}`,
        status,
        message: safeMessage,
      });
    } catch {
      res.status(status).type('text/plain').send(`Error ${status}: ${safeMessage}`);
    }
  }
}
