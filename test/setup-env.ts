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
process.env.BKASH_USERNAME ??= 'sandboxUser';
process.env.BKASH_PASSWORD ??= 'sandboxPass';
process.env.BKASH_APP_KEY ??= 'sandbox_app_key';
process.env.BKASH_APP_SECRET ??= 'sandbox_app_secret';
process.env.BKASH_IS_LIVE ??= 'false';
process.env.BKASH_CALLBACK_URL ??= 'http://localhost:3000/payments/bkash/callback';
