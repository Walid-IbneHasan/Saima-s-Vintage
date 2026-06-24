import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as nunjucks from 'nunjucks';

type ViteManifestEntry = { file: string; css?: string[] };
type ViteManifest = Record<string, ViteManifestEntry>;

/**
 * Configure Nunjucks as the SSR view engine.
 * - autoescape ON (output is escaped by default → XSS-safe templates).
 * - registers an `asset()` global that resolves Vite's hashed filenames.
 */
export function configureViews(
  app: NestExpressApplication,
  isProd: boolean,
): nunjucks.Environment {
  const viewsDir = join(process.cwd(), 'views');
  const server = app.getHttpAdapter().getInstance();

  const env = nunjucks.configure(viewsDir, {
    autoescape: true,
    express: server,
    watch: !isProd,
    noCache: !isProd,
  });

  registerGlobals(env, isProd);

  app.setBaseViewsDir(viewsDir);
  server.set('view engine', 'njk');
  return env;
}

function registerGlobals(env: nunjucks.Environment, isProd: boolean): void {
  const manifestPath = join(
    process.cwd(),
    'public',
    'build',
    '.vite',
    'manifest.json',
  );
  let manifest: ViteManifest = {};

  const loadManifest = (): void => {
    try {
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ViteManifest;
      }
    } catch {
      manifest = {};
    }
  };
  loadManifest();

  // Resolve a built asset's public URL from the Vite manifest.
  env.addGlobal('asset', (entry: string): string => {
    if (!isProd) loadManifest();
    const item = manifest[entry];
    return item ? `/build/${item.file}` : `/build/${entry}`;
  });

  // CSS files emitted alongside a JS entry (when CSS is imported in JS).
  env.addGlobal('assetCss', (entry: string): string[] => {
    if (!isProd) loadManifest();
    const item = manifest[entry];
    return (item?.css ?? []).map((f) => `/build/${f}`);
  });

  env.addGlobal('appName', process.env.APP_NAME ?? "Saima's Vintage");
  env.addGlobal('appUrl', process.env.APP_URL ?? '');
  env.addGlobal('currentYear', new Date().getFullYear());

  // BDT money formatter for templates.
  env.addFilter('money', (value: unknown, currency = 'BDT') => {
    const n = Number(value);
    if (Number.isNaN(n)) return value;
    const formatted = n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'BDT' ? `৳${formatted}` : `${currency} ${formatted}`;
  });

  // Compact date/time for admin tables.
  env.addFilter('date', (value: unknown) => {
    if (!value) return '';
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  });

  // Value for an <input type="datetime-local"> — server-local wall-clock
  // (YYYY-MM-DDTHH:mm), so it round-trips with `new Date(value)` on submit.
  env.addFilter('dtLocal', (value: unknown) => {
    if (!value) return '';
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
}
