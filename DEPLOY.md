# Deploying Saima's Vintage to Hostnil (cPanel + LiteSpeed + Passenger)

This is the concrete runbook for the **Hostnil SEED B** plan (1.5 GB RAM, LiteSpeed,
CloudLinux Node Selector / Passenger). The app is **built locally** and uploaded as
`deploy.tar.gz` — the server only installs production deps and runs migrations
(building `tsc`/`vite` on shared hosting can exceed the memory limit).

Throughout, replace the ALL-CAPS placeholders:
`DOMAIN`, `CPUSER` (cPanel username), `APPROOT` (e.g. `saimas-vintage`),
`DBNAME`, `DBUSER`, `DBPASS`.

---

## Build the bundle (local, one command)

```bash
npm ci
npm run prisma:generate
npm run build                 # → dist/ + public/build/
tar -czf deploy.tar.gz dist public prisma views scripts package.json package-lock.json app.js
```

`deploy.tar.gz` contains exactly: `app.js dist/ public/ prisma/ views/ scripts/ package.json package-lock.json`.

> **Windows note:** build the archive with `tar` (Git Bash), **not** PowerShell
> `Compress-Archive` — it writes backslash paths (`dist\main.js`) that break when
> extracted on Linux. Verify with `tar -tzf deploy.tar.gz | head` (must show
> `dist/main.js`). cPanel File Manager extracts `.tar.gz` natively.
>
> The Prisma **CLI** is a runtime `dependency` (not devDependency), so
> `npm ci --omit=dev` on the server still installs it and `prisma migrate deploy`
> works without dev deps.

---

## Phase 1 — cPanel UI (no terminal)

1. **MySQL Databases** → create database `DBNAME`, user `DBUSER` (note `DBPASS`),
   then **Add User To Database** → **ALL PRIVILEGES**. (cPanel prefixes both with
   your account, e.g. `CPUSER_saimas`.)

2. **Setup Node.js App** → **Create Application**:
   - Node.js version: **20+** (newest available; the live site runs on **24**).
     `NODEVER` below = the version you pick (e.g. `24`).
   - Application mode: **Production**
   - Application root: `APPROOT` (this is also the runtime working directory —
     the `.env` and `tmp/restart.txt` live here)
   - Application URL: your `DOMAIN`
   - Application startup file: `app.js`
   - Create. Leave this page open — it shows the **"Enter to the virtual environment"**
     command (e.g. `source /home/CPUSER/nodevenv/APPROOT/NODEVER/bin/activate && cd ...`)
     and a **RESTART** button.

3. **File Manager** → open `APPROOT` → **Upload** `deploy.tar.gz` → select it →
   **Extract** → into `APPROOT`. You should now see `app.js`, `dist/`, `public/`,
   `prisma/`, `views/`, `scripts/`, `package.json`. Delete the tarball after.

---

## Phase 2 — terminal (install, configure, launch)

No SSH keys required — the simplest path is cPanel's web **Terminal** (Tools →
Terminal). Or connect from your own machine (host/port/user are in cPanel →
**SSH Access**; port is often `22`): `ssh CPUSER@DOMAIN`.

Enter the app's Node environment (copy the exact line from the Node.js App page —
`NODEVER` is the version you chose, e.g. `24`):
```bash
source /home/CPUSER/nodevenv/APPROOT/NODEVER/bin/activate && cd /home/CPUSER/APPROOT
```

Install prod deps + generate the Prisma client for this server's OpenSSL:
```bash
npm ci --omit=dev
npx prisma generate
```

Create the production `.env` (secrets are generated on-server, never typed).
**Edit the domain, DB, and bKash lines first**, then paste the whole block:
```bash
cat > .env <<EOF
NODE_ENV=production
APP_NAME="Saima's Vintage"
APP_URL=https://DOMAIN
TRUST_PROXY=1
SESSION_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
CSRF_SECRET=$(openssl rand -hex 32)
CRON_TOKEN=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
DATABASE_URL="mysql://DBUSER:DBPASS@localhost:3306/DBNAME"
DEFAULT_CURRENCY=BDT
RESERVATION_TTL_MINUTES=30
LOW_STOCK_DEFAULT_THRESHOLD=3

# bKash — start in sandbox to smoke-test on the live domain, then flip to live.
BKASH_USERNAME=your_bkash_username
BKASH_PASSWORD=your_bkash_password
BKASH_APP_KEY=your_bkash_app_key
BKASH_APP_SECRET=your_bkash_app_secret
BKASH_IS_LIVE=false
BKASH_CALLBACK_URL=https://DOMAIN/payments/bkash/callback

# Email (optional; fill to enable order/notification mail)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="Saima's Vintage <no-reply@DOMAIN>"
# Inbox that gets a copy of every confirmed order (defaults to saimasvintage@gmail.com).
ORDER_NOTIFICATION_EMAIL=saimasvintage@gmail.com

# Google OAuth (optional; leave blank to hide the Google button)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
EOF
```

Apply the schema and create the first admin:
```bash
npx prisma migrate deploy
node scripts/create-admin.js admin@DOMAIN 'CHOOSE-A-STRONG-PASSWORD' 'Site Admin'
```

> `create-admin.js` loads `.env` itself, so the bare command works. If you ever
> hit `Environment variable not found: DATABASE_URL` (e.g. from an older bundle),
> prefix it once:
> `DATABASE_URL="mysql://DBUSER:DBPASS@localhost:3306/DBNAME" node scripts/create-admin.js ...`
> Re-running with the same email just resets that admin's password (idempotent).

Restart Passenger and confirm it's up:
```bash
mkdir -p tmp && touch tmp/restart.txt
curl -fsS https://DOMAIN/health        # → {"status":"ok","db":"up",...}
```

> The `.env` sits in the app root (outside the web docroot) and is never served.
> Keep the `CRON_TOKEN` handy for the next phase: `grep CRON_TOKEN .env`.

---

## Phase 3 — SSL, cron, go-live

1. **HTTPS** — open cPanel → **SSL/TLS Status** (Security section; this is a
   *different* page from the "SSL/TLS" manager/Wizard). Tick `DOMAIN` and
   `www.DOMAIN`, click **Run AutoSSL**, wait ~1–5 min until the status flips from
   *self-signed* to a **valid** certificate. (Required before admin login works —
   the app sets `secure` cookies, which need real HTTPS. The `*.DOMAIN` wildcard
   can't be issued over HTTP validation; you don't need it.) Then click **RESTART**
   on the Node.js App so it picks up the final `.env`.

2. **Cron Jobs** — add these (replace `TOKEN` with the `CRON_TOKEN` value):
   ```
   */5 * * * *  curl -fsS -X POST -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/run-jobs
   */5 * * * *  curl -fsS -X POST -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/expire-orders
   */5 * * * *  curl -fsS -X POST -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/reconcile-payments
   0   * * * *  curl -fsS -X POST -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/low-stock-scan
   30  3 * * *  curl -fsS -X POST -H "X-Cron-Token: TOKEN" https://DOMAIN/internal/cron/clean-carts
   ```
   `reconcile-payments` is the bKash safety net (no webhook): it settles payments
   where the customer paid but the browser callback never returned.

3. **Smoke test** the storefront on `https://DOMAIN`, log in at `/admin/login`,
   add a product, and place a test order (bKash sandbox wallet `01770618576`,
   OTP `123456`, PIN `12121`).

4. **Go live with bKash**: set your real merchant `BKASH_*` creds, `BKASH_IS_LIVE=true`,
   whitelist `https://DOMAIN/payments/bkash/callback` in the bKash merchant panel,
   then `touch tmp/restart.txt`.

---

## Enable Google sign-in (optional)

The "Continue with Google" button on `/login` and `/register` is **shown only when
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set**. It works locally already;
to turn it on for the live site:

1. **Google Cloud Console** → <https://console.cloud.google.com> → *APIs & Services*
   → *Credentials*. Use your existing **OAuth 2.0 Client ID** (or *Create credentials
   → OAuth client ID → Web application*). Add:
   - **Authorized JavaScript origins:** `https://DOMAIN`
   - **Authorized redirect URIs:** `https://DOMAIN/auth/google/callback`
     (must match exactly — this is the URL the app derives from `APP_URL`).
2. On the *OAuth consent screen*, either add your testers under *Test users* or click
   *Publish app* so any Google account can sign in.
3. Put the two secrets in the production `.env` (leave `GOOGLE_CALLBACK_URL` blank —
   it auto-derives from `APP_URL=https://DOMAIN`):
   ```bash
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```
4. Restart so it picks up the new env: `touch tmp/restart.txt` (or **RESTART** the
   Node.js App in cPanel). The button appears immediately.

> Customers who first signed up with email/password and later click "Continue with
> Google" are linked to the same account by email — no duplicate is created.

---

## Redeploys (after code changes)

```bash
# local — exclude public/uploads so the bundle never overwrites live product images
npm run build && tar -czf deploy.tar.gz --exclude='public/uploads' dist public prisma views scripts package.json package-lock.json app.js
# upload + extract into APPROOT (overwrite), then over SSH:
source .../activate && cd /home/CPUSER/APPROOT
# npm ci / prisma generate only when dependencies or prisma/schema.prisma changed:
npm ci --omit=dev && npx prisma generate
npx prisma migrate deploy   # applies pending migrations only (no-op if none)
touch tmp/restart.txt
```

> Order/notification email needs SMTP configured in `.env` (`SMTP_HOST`, `SMTP_USER`,
> `SMTP_PASSWORD`, `SMTP_FROM`) **and** the `run-jobs` cron running — every confirmed
> order queues a confirmation to the customer plus a full-detail copy to
> `ORDER_NOTIFICATION_EMAIL` (defaults to saimasvintage@gmail.com).

## Troubleshooting
- **502 / app won't start** → app's `stderr.log` in `APPROOT`, and cPanel **Errors**.
  Usually a missing/invalid env var (the app fails fast on bad config) or
  `DATABASE_URL`. After any `.env` change, click **RESTART** (Passenger caches env).
- **`Environment variable not found: DATABASE_URL`** when running a `node` script →
  plain `node` doesn't auto-load `.env` (the Prisma CLI and the app do).
  `create-admin.js` self-loads `.env`; otherwise prefix `DATABASE_URL=... node ...`.
- **MySQL connection refused** → try `127.0.0.1` instead of `localhost` in
  `DATABASE_URL`. If the DB password contains `@ : / # ?`, URL-encode it (or reset
  the DB user's password to letters+numbers in **MySQL Databases**).
- **Prisma engine error** → confirm `binaryTargets` in `prisma/schema.prisma`
  includes this server's OpenSSL (`openssl version`: 1.1 → `rhel-openssl-1.1.x`,
  3.0 → `rhel-openssl-3.0.x`), then re-run `npx prisma generate` on the server.
- **Static assets 404** → ensure `public/build/` extracted and `tmp/restart.txt` touched.
- **Image upload fails / `sharp` error** → `sharp` is a native module; `npm ci --omit=dev`
  on the server fetches its Linux build automatically (needs outbound HTTPS during
  install). If it ever fails to load, re-run `npm ci --omit=dev` on the server (don't
  copy local `node_modules` from Windows — the binaries differ). Uploaded images are
  re-encoded to WebP under `public/uploads/{products,categories,avatars}`.
- **bKash "token grant failed"** → wrong creds, or `BKASH_IS_LIVE` doesn't match the
  credentials' environment (sandbox creds with `IS_LIVE=true` fails).
