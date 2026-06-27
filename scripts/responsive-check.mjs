// Ad-hoc responsive QA: drives system Edge across device widths, screenshots
// every page, and flags horizontal overflow. Not part of the app/test suite.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:3000';
const OUT = 'D:/Saima\'s Vintage/_shots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

const SLUG = '/p/silk-tea-dress-1960s';
const CAT = '/c/dresses';

async function overflow(page, vw) {
  return page.evaluate((vw) => {
    const de = document.documentElement;
    const offenders = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1)) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') || '').slice(0, 70),
          right: Math.round(r.right),
        });
      }
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, offenders: offenders.slice(0, 6) };
  }, vw);
}

async function shoot(ctx, label, path, report) {
  const page = await ctx.page;
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  const o = await overflow(page, ctx.vp.width);
  const over = o.scrollW - o.clientW;
  const tag = over > 1 ? `OVERFLOW +${over}px` : 'ok';
  report.push({ vp: ctx.vp.name, path, over, tag, offenders: over > 1 ? o.offenders : [] });
  const safe = (label + '_' + ctx.vp.name).replace(/[^a-z0-9_-]/gi, '_');
  await page.screenshot({ path: `${OUT}/${safe}.png`, fullPage: true });
}

const PUBLIC = [
  ['home', '/'],
  ['products', '/products'],
  ['products-filtered', '/products?onSale=1&sort=price_asc'],
  ['category', CAT],
  ['product', SLUG],
  ['search', '/search?q=dress'],
  ['login', '/login'],
  ['register', '/register'],
  ['forgot', '/forgot'],
  ['error404', '/this-page-does-not-exist'],
];

const ADMIN = [
  ['admin-dashboard', '/admin'],
  ['admin-products', '/admin/products'],
  ['admin-orders', '/admin/orders'],
  ['admin-categories', '/admin/categories'],
  ['admin-product-form', '/admin/products/new'],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const ctx = { page, vp };

  // Public pages
  for (const [label, path] of PUBLIC) await shoot(ctx, label, path, report);

  // Cart + checkout: add an item first via the real form
  await page.goto(BASE + SLUG, { waitUntil: 'networkidle' });
  const addBtn = page.locator('form[action="/cart/items"] button[type="submit"]');
  if (await addBtn.count()) { await addBtn.first().click().catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); }
  await shoot(ctx, 'cart', '/cart', report);
  await shoot(ctx, 'checkout', '/checkout', report);

  // Admin: log in once, then screenshot
  await page.goto(BASE + '/admin/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'admin@saimasvintage.test').catch(() => {});
  await page.fill('input[name="password"]', 'ChangeMe123!').catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  const loggedIn = !page.url().includes('/login');
  for (const [label, path] of ADMIN) await shoot(ctx, loggedIn ? label : label + '-NOAUTH', path, report);

  await context.close();
}

await browser.close();

// Print report grouped by overflow
const bad = report.filter((r) => r.over > 1);
console.log('\n==== RESPONSIVE REPORT ====');
console.log(`screens: ${report.length}, overflow issues: ${bad.length}\n`);
for (const r of bad) {
  console.log(`OVERFLOW ${r.vp} ${r.path} (+${r.over}px)`);
  for (const o of r.offenders) console.log(`    <${o.tag} class="${o.cls}"> right=${o.right}`);
}
if (!bad.length) console.log('No horizontal overflow detected on any page/viewport. ✅');
console.log(`\nScreenshots: ${OUT}`);
