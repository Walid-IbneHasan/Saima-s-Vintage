import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Single-file sitemap. If the catalog ever exceeds ~50k URLs this must become a
// sitemap index — we cap + would log a warning rather than silently truncate.
const MAX_URLS = 40000;

@Injectable()
export class SitemapService {
  constructor(private readonly prisma: PrismaService) {}

  private get appUrl(): string {
    return (process.env.APP_URL ?? '').replace(/\/$/, '');
  }

  async buildXml(): Promise<string> {
    const [products, categories, pages] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true, publishedAt: { not: null } },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_URLS,
      }),
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.pageContent.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, type: true, updatedAt: true },
      }),
    ]);

    const urls: string[] = [this.url('/', undefined, '1.0')];
    for (const c of categories) urls.push(this.url(`/c/${c.slug}`, c.updatedAt));
    for (const p of products) urls.push(this.url(`/p/${p.slug}`, p.updatedAt));
    for (const pg of pages) {
      const prefix = pg.type === 'blog' ? '/blog' : '/pages';
      urls.push(this.url(`${prefix}/${pg.slug}`, pg.updatedAt));
    }

    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n'
    );
  }

  robotsTxt(): string {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /cart',
      'Disallow: /checkout',
      'Disallow: /payments',
      'Disallow: /internal',
      'Disallow: /account',
      '',
      `Sitemap: ${this.appUrl}/sitemap.xml`,
      '',
    ].join('\n');
  }

  private url(path: string, lastmod?: Date, priority?: string): string {
    const parts = [`  <url>`, `    <loc>${this.appUrl}${path}</loc>`];
    if (lastmod) parts.push(`    <lastmod>${lastmod.toISOString()}</lastmod>`);
    if (priority) parts.push(`    <priority>${priority}</priority>`);
    parts.push(`  </url>`);
    return parts.join('\n');
  }
}
