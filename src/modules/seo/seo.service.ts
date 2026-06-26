import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveProductPricing } from '../../common/pricing';

interface ProductForLd {
  name: string;
  slug: string;
  sku: string | null;
  shortDescription: string | null;
  basePrice: Prisma.Decimal;
  salePrice: Prisma.Decimal | null;
  flashPrice?: Prisma.Decimal | null;
  flashStartAt?: Date | null;
  flashEndAt?: Date | null;
  currency: string;
  images: { url: string }[];
}

interface Crumb {
  name: string;
  path: string;
}

@Injectable()
export class SeoService {
  private get appUrl(): string {
    return (process.env.APP_URL ?? '').replace(/\/$/, '');
  }

  abs(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.appUrl}${path}`;
  }

  /** Serialize for an inline <script type="application/ld+json">, escaping `<`. */
  private serialize(obj: unknown): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c');
  }

  productJsonLd(p: ProductForLd, inStock: boolean): string {
    // Advertise the price actually charged (discounted when on sale or during a
    // live flash deal).
    const resolved = resolveProductPricing(p, new Date());
    const current =
      resolved.salePrice && resolved.salePrice.lessThan(resolved.basePrice)
        ? resolved.salePrice
        : resolved.basePrice;
    const obj = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      ...(p.shortDescription ? { description: p.shortDescription } : {}),
      ...(p.sku ? { sku: p.sku } : {}),
      image: p.images.map((i) => this.abs(i.url)),
      offers: {
        '@type': 'Offer',
        url: this.abs(`/p/${p.slug}`),
        priceCurrency: p.currency,
        price: current.toString(),
        availability: inStock
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
    };
    return this.serialize(obj);
  }

  breadcrumbJsonLd(crumbs: Crumb[]): string {
    const obj = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: this.abs(c.path),
      })),
    };
    return this.serialize(obj);
  }
}
