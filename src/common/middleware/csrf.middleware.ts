import { randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Server-side double-submit CSRF.
 * - A random token is kept in an httpOnly cookie (`sv_csrf`).
 * - The server injects the same token into rendered forms (res.locals.csrfToken).
 * - State-changing requests must echo it back via body `_csrf`, header
 *   `x-csrf-token`, or query `_csrf` (the query form is for multipart uploads,
 *   whose body isn't parsed before this middleware runs).
 * - Server-to-server endpoints (payments IPN, cron) are exempt.
 */
export function createCsrfMiddleware() {
  const isProd = process.env.NODE_ENV === 'production';

  return function csrf(req: Request, res: Response, next: NextFunction): void {
    const path = req.path;
    if (
      path.startsWith('/build') ||
      path.startsWith('/uploads') ||
      path === '/favicon.ico'
    ) {
      return next();
    }

    let token = (req.cookies?.sv_csrf as string | undefined) ?? '';
    if (!token) {
      token = randomBytes(32).toString('hex');
      res.cookie('sv_csrf', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
      });
    }
    res.locals.csrfToken = token;

    const exempt =
      path.startsWith('/payments/') ||
      path.startsWith('/internal/') ||
      path.startsWith('/health');

    if (STATE_CHANGING.has(req.method.toUpperCase()) && !exempt) {
      const submitted =
        (req.body?._csrf as string | undefined) ||
        (req.headers['x-csrf-token'] as string | undefined) ||
        (req.query?._csrf as string | undefined) ||
        '';
      if (!submitted || !safeEqual(submitted, token)) {
        res.status(403).type('text/plain').send('Invalid CSRF token');
        return;
      }
    }

    next();
  };
}
