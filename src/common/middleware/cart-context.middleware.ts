import { NextFunction, Request, Response } from 'express';
import type { CartService } from '../../modules/cart/cart.service';

/**
 * Exposes the current cart's item count to every SSR page via
 * res.locals.cartCount, so the header can render a badge on the cart icon.
 * Resolves the existing cart from the cookie WITHOUT creating one (no
 * side-effects); no cart cookie → no DB hit → count 0. SSR, so the badge works
 * with JavaScript disabled.
 */
export function createCartContextMiddleware(getCartService: () => CartService) {
  return async function cartContext(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const cart = await getCartService().resolveCart(req, res, false);
      res.locals.cartCount = await getCartService().count(cart);
    } catch {
      res.locals.cartCount = 0;
    }
    next();
  };
}
