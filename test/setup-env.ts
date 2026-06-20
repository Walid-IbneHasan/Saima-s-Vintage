// Runs before each test file (jest setupFiles). Points the app at an isolated
// test database derived from DATABASE_URL, before Prisma/Config load.
import { URL } from 'url';

const devUrl =
  process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/saimas_vintage';

const u = new URL(devUrl);
u.pathname = '/saimas_vintage_test';

process.env.DATABASE_URL = u.toString();
process.env.NODE_ENV = 'test';
// Ensure required secrets exist even if .env is absent in CI.
process.env.SESSION_SECRET ??= 'test_session_secret_0123456789abcdef';
process.env.COOKIE_SECRET ??= 'test_cookie_secret_0123456789abcdef0';
process.env.CSRF_SECRET ??= 'test_csrf_secret_0123456789abcdef012';
process.env.CRON_TOKEN ??= 'test_cron_token_0123456789abcdef0123';
process.env.SSLCOMMERZ_STORE_ID ??= 'testbox';
process.env.SSLCOMMERZ_STORE_PASSWORD ??= 'qwerty';
process.env.SSLCOMMERZ_SUCCESS_URL ??= 'http://localhost:3000/payments/sslcommerz/success';
process.env.SSLCOMMERZ_FAIL_URL ??= 'http://localhost:3000/payments/sslcommerz/fail';
process.env.SSLCOMMERZ_CANCEL_URL ??= 'http://localhost:3000/payments/sslcommerz/cancel';
process.env.SSLCOMMERZ_IPN_URL ??= 'http://localhost:3000/payments/sslcommerz/ipn';
