'use strict';
/**
 * Create (or update) an admin user — production-safe.
 *
 * Plain CommonJS so it runs with `node` and only the production dependencies
 * (@prisma/client + bcryptjs), i.e. it works after `npm ci --omit=dev`. Unlike
 * `prisma/seed.ts`, this NEVER wipes tables or inserts demo data.
 *
 * Usage (in the cPanel Node.js app environment, so DATABASE_URL is set):
 *   node scripts/create-admin.js <email> <password> [name]
 * or with env vars:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME="..." node scripts/create-admin.js
 *
 * Re-running with the same email resets that admin's password (idempotent).
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// Plain `node` (unlike the Prisma CLI / NestJS) does not auto-load `.env`, so
// load it ourselves from the app root — without adding a dependency.
function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let [, key, val] = m;
      val = val.trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env file — rely on the real environment */
  }
}
loadDotEnv();

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || '';
  const name = process.argv[4] || process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    console.error('Usage: node scripts/create-admin.js <email> <password> [name]');
    console.error('   or set ADMIN_EMAIL / ADMIN_PASSWORD (/ ADMIN_NAME) env vars.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Refusing: password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN, isActive: true },
    create: { email, name, passwordHash, role: Role.ADMIN, isActive: true },
  });
  console.log(`✅ Admin ready: ${user.email} (role ${user.role}). You can log in at /admin/login`);
}

main()
  .catch((e) => {
    console.error('Failed to create admin:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
