import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';

/**
 * Makes the logged-in customer (id + name) available to every SSR page via
 * res.locals.currentCustomer, so the navbar can show Login/Register vs Account.
 * Reads it from the JWT payload — no DB hit. Invalid/absent token → no customer.
 */
export function createCustomerContextMiddleware(getJwt: () => JwtService) {
  return function customerContext(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.sv_customer as string | undefined;
    if (token) {
      try {
        const payload = getJwt().verify<{ sub: string; name: string; email: string }>(token);
        res.locals.currentCustomer = {
          id: payload.sub,
          name: payload.name,
          email: payload.email,
        };
      } catch {
        /* invalid/expired token → treat as logged out */
      }
    }
    next();
  };
}
