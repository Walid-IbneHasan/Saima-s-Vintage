/**
 * Housekeeping: clear expired flash-deal fields from products.
 *
 * NOTE: flash deals already expire automatically at read/charge time — pricing
 * and the storefront "Flash Deals" filter are evaluated against the current time
 * on every request, so an expired deal disappears on its own with NO job. This
 * script is purely OPTIONAL tidy-up: it nulls out the flash columns of deals
 * whose end time has passed so they don't linger in admin/queries.
 *
 * cPanel cron usage (e.g. hourly). Node 20.6+ can load .env directly:
 *
 *   cd /home/<cpanel-user>/<app-dir> && \
 *     /path/to/bin/node --env-file=.env dist/scripts/expire-flash-deals.js
 *
 * Adjust the node binary path and app directory to your account. The script
 * needs DATABASE_URL in the environment (the --env-file flag supplies it).
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const result = await prisma.product.updateMany({
      where: { flashEndAt: { not: null, lt: now } },
      data: { flashPrice: null, flashStartAt: null, flashEndAt: null },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[expire-flash-deals] cleared ${result.count} expired flash deal(s) at ${now.toISOString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[expire-flash-deals] failed:', err);
  process.exit(1);
});
