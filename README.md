# Saima's Vintage

Server-rendered e-commerce for vintage one-of-a-kind items.
**NestJS (Express adapter) + Prisma + MySQL/MariaDB + SSLCOMMERZ**, rendered with
Nunjucks and progressively enhanced with Alpine.js / HTMX. Built to deploy on
**HostSeba cPanel** (CloudLinux + LiteSpeed + Phusion Passenger).

> Status: **Phase 0 (foundation)** complete. Catalog, cart/checkout, payments,
> SEO, analytics, and polish follow in later phases (see Build Phases below).

---

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 20 | NestJS 11 requirement; verify the version in cPanel |
| Framework | NestJS 11, **Express adapter** | Fastify conflicts with Passenger's loader |
| ORM | Prisma 6 | binary engine, no compiler needed on server |
| DB | MySQL / MariaDB | available on HostSeba |
| Views | Nunjucks (autoescaped) | SSR, SEO, works without JS |
| Assets | Vite + Tailwind CSS | hashed build into `public/build` |
| Interactivity | Alpine.js + HTMX | lightweight progressive enhancement |
| Payments | SSLCOMMERZ | server-to-server validated |
| Auth hashing | bcryptjs (pure JS) | avoids node-gyp build on shared hosting |
| Queue | DB `Job` table + cPanel cron | no Redis/worker assumed |

## Local development

```bash
cp .env.example .env          # then fill real values (generate secrets below)
npm install
npm run prisma:generate       # generate Prisma client (required before build)

# Create the schema in your local MySQL/MariaDB:
npm run prisma:migrate        # dev migrations
npm run seed                  # demo admin + product

npm run build:client          # build Tailwind/JS into public/build
npm run dev                   # start NestJS in watch mode → http://localhost:3000
```

Generate secrets:
```bash
openssl rand -hex 32   # use for SESSION_SECRET, COOKIE_SECRET, CSRF_SECRET, CRON_TOKEN
```

Health check: `GET /health` → `{ "status": "ok", "db": "up", ... }`.

## Production build

```bash
npm ci
npm run prisma:generate
npm run build                 # builds client assets + compiles TS → dist/main.js
```

Start command (what Passenger runs via `app.js`):
```bash
node dist/main.js             # listens on process.env.PORT (injected by Passenger)
```

---

## Deploying to HostSeba cPanel (Passenger)

### 0. Pre-flight checks (must verify before going live)
1. **Node ≥ 20** is offered in *Setup Node.js App*.
2. The server's OpenSSL/distro for Prisma — run `openssl version` over SSH. Keep
   only the matching `binaryTargets` entry in `prisma/schema.prisma`
   (`rhel-openssl-1.1.x` for AlmaLinux 8 / CentOS 7, `rhel-openssl-3.0.x` for AlmaLinux 9).
3. **LVE memory** ≥ 1 GB and adequate entry processes for Node + Prisma.
4. Outbound HTTPS to `securepay.sslcommerz.com` is allowed; the IPN URL is publicly reachable.

### 1. Create the database
cPanel → *MySQL Databases* → create DB + user, grant all privileges. Note the
credentials for `DATABASE_URL` (`mysql://user:pass@localhost:3306/dbname`).

### 2. Create the Node.js app
cPanel → *Setup Node.js App* → Create:
- **Node version:** 20+ (latest available)
- **Application mode:** Production
- **Application root:** e.g. `apps/saimas-vintage`
- **Application URL:** your domain
- **Application startup file:** `app.js`

### 3. Upload the build
Because `tsc`/`vite` can exceed LVE memory, **build locally** and upload:
```
dist/            public/build/      prisma/        views/
package.json     package-lock.json  app.js         .env (set via panel, not committed)
```
Then in the app's virtualenv (SSH or the panel's "Run NPM Install"):
```bash
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
```

### 4. Environment variables
Add every key from `.env.example` in the Node.js App **Environment variables**
panel. Do **not** upload a real `.env` into the web root. `SSLCOMMERZ_IS_LIVE=true`
only in production.

### 5. Restart / logs
- **Restart:** click *Restart* in the panel, or `touch tmp/restart.txt` in the app root.
- **Logs:** cPanel *Errors* + the app's `stderr.log`; app logs print to stdout/stderr.

### 6. Cron jobs (cPanel → Cron Jobs)
All hit token-guarded internal endpoints (added in Phase 5). Send header
`X-Cron-Token: $CRON_TOKEN`.
```
*/5 * * * *  curl -fsS -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/run-jobs
*/5 * * * *  curl -fsS -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/expire-orders
0   * * * *  curl -fsS -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/low-stock-scan
30  3 * * *  curl -fsS -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/clean-carts
```

### 7. HTTPS & static files
- Enable AutoSSL / Let's Encrypt for the domain.
- LiteSpeed serves `/public` (incl. `/build` and `/uploads`) directly.
- Ensure `.env` and source are outside the document root; uploads dir is non-executable.

### 8. Backups
- **DB:** `mysqldump -u USER -p DBNAME > backup.sql` (or cPanel *Backup*).
- **Uploads:** archive `public/uploads/`.
- **Secrets:** keep an encrypted copy of the env values off-server.

---

## Build phases
0. ✅ Foundation (this scaffold)
1. Catalog + Admin (products/categories/variants/images, admin CRUD, auth/guards/audit, storefront browse/detail/search)
2. Cart + Checkout + Inventory locking (transactional, `SELECT … FOR UPDATE`, reservations)
3. SSLCOMMERZ (session, success/fail/cancel, IPN, Order Validation API, idempotency, payment_review)
4. SEO + sitemap + performance (JSON-LD, meta, sitemap, robots, N+1 guards, pagination, cache)
5. Analytics + notifications + DB-queue/cron (sales aggregates, Nodemailer, low-stock, abandoned cart)
6. 3D polish + animations (lightweight, lazy, JS-optional) — **last**

## Security baseline
Helmet, secure/httpOnly/SameSite cookies, throttling, strict validation
(class-validator + Zod env), Prisma parameterized queries, autoescaped templates,
server-side price recomputation, audit logs, server-to-server payment validation.
CSRF (`csrf-csrf`) is wired in with the first forms (Phase 1).
