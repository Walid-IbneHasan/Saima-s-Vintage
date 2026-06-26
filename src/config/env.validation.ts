import { z } from 'zod';

/**
 * Coerce common truthy/falsey strings to a real boolean.
 * NOTE: z.coerce.boolean() treats the string "false" as `true`, which is a
 * footgun for env flags — so we parse explicitly.
 */
const boolish = z.preprocess(
  (v) => v === true || v === 'true' || v === '1' || v === 'yes',
  z.boolean(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Passenger/cPanel injects PORT. Locally we fall back to 3000.
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().min(1).default("Saima's Vintage"),
  APP_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  // Secrets — must be set in every environment.
  SESSION_SECRET: z.string().min(16, 'must be at least 16 chars'),
  COOKIE_SECRET: z.string().min(16, 'must be at least 16 chars'),
  CSRF_SECRET: z.string().min(16, 'must be at least 16 chars'),
  CRON_TOKEN: z.string().min(16, 'must be at least 16 chars'),
  JWT_SECRET: z.string().min(16, 'must be at least 16 chars'),

  // Google OAuth (optional — "Continue with Google" is hidden when unset).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  DATABASE_URL: z.string().min(1),

  // bKash PGW Tokenized Checkout (merchant API credentials — server-side only).
  BKASH_USERNAME: z.string().min(1),
  BKASH_PASSWORD: z.string().min(1),
  BKASH_APP_KEY: z.string().min(1),
  BKASH_APP_SECRET: z.string().min(1),
  BKASH_IS_LIVE: boolish.default(false),
  // Where bKash returns the customer (GET, with ?paymentID&status).
  BKASH_CALLBACK_URL: z.string().url(),

  DEFAULT_CURRENCY: z.string().min(1).default('BDT'),

  // Email (optional until Phase 5)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Inventory
  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  LOW_STOCK_DEFAULT_THRESHOLD: z.coerce.number().int().nonnegative().default(3),
});

export type Env = z.infer<typeof envSchema>;

/** Used as the `validate` hook for @nestjs/config — fails fast on bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
