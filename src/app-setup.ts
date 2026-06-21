import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createCartContextMiddleware } from './common/middleware/cart-context.middleware';
import { createCsrfMiddleware } from './common/middleware/csrf.middleware';
import { createCustomerContextMiddleware } from './common/middleware/customer-context.middleware';
import { CartService } from './modules/cart/cart.service';
import { configureViews } from './common/view-engine';
import { CategoryNavService } from './modules/catalog/category-nav.service';

/**
 * Applies all runtime configuration (security, parsers, static, CSRF, views,
 * pipes, filters) to a Nest app. Shared by main.ts and the test harness so both
 * exercise identical middleware. Create the app with `{ bodyParser: false }`.
 */
export function setupApp(app: NestExpressApplication): void {
  const isProd = process.env.NODE_ENV === 'production';
  const server = app.getHttpAdapter().getInstance();

  server.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  server.disable('x-powered-by');

  // Content Security Policy. 'unsafe-eval' is required by Alpine.js/HTMX inline
  // expressions; everything else is locked to same-origin. (To drop
  // 'unsafe-eval' later, switch to the Alpine CSP build.)
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          formAction: ["'self'"],
          // Only force https upgrades in production (would break http://localhost).
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser(process.env.COOKIE_SECRET));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Hashed build assets are safe to cache hard; uploads moderately.
  app.useStaticAssets(join(process.cwd(), 'public'), {
    index: false,
    maxAge: isProd ? '7d' : 0,
  });
  app.use(createCsrfMiddleware());
  // Expose the logged-in customer (from the JWT cookie) to every page.
  app.use(createCustomerContextMiddleware(() => app.get(JwtService, { strict: false })));
  // Expose the cart item count (from the cart cookie) for the header badge.
  app.use(createCartContextMiddleware(() => app.get(CartService, { strict: false })));

  const njk = configureViews(app, isProd);
  // Category menu available to every server-rendered page (cached).
  let navRef: CategoryNavService | null = null;
  njk.addGlobal('navCategories', () => {
    try {
      const nav: CategoryNavService =
        navRef ?? app.get(CategoryNavService, { strict: false });
      navRef = nav;
      return nav.getCached();
    } catch {
      return [];
    }
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(isProd));
}
