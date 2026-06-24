import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PageParams } from '../../common/pagination';
import {
  PriceView,
  isFlashActive,
  onSaleWhere,
  productPriceView,
  resolveProductPricing,
} from '../../common/pricing';
import { ProductFilters } from '../../common/product-filters';

// Shared card projection — keeps listing queries to a constant number of
// statements (products + variants + images), never one-per-row (no N+1).
const cardSelect = {
  id: true,
  name: true,
  slug: true,
  basePrice: true,
  salePrice: true,
  flashPrice: true,
  flashStartAt: true,
  flashEndAt: true,
  currency: true,
  images: {
    take: 1,
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    select: { url: true, alt: true },
  },
  variants: {
    where: { isActive: true },
    select: { stock: true },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  currency: string;
  image: { url: string; alt: string | null } | null;
  inStock: boolean;
  pricing: PriceView;
  /** End time of a live flash deal (null when no flash is currently active). */
  flashEndsAt: Date | null;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(
    params: PageParams,
    opts: { categoryId?: string; filters?: ProductFilters } = {},
  ): Promise<{ items: ProductCard[]; total: number }> {
    const f = opts.filters;
    const now = new Date();

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      publishedAt: { not: null },
      ...(opts.categoryId
        ? { categories: { some: { categoryId: opts.categoryId } } }
        : {}),
    };

    if (f) {
      // Price range filters on the regular (list) price.
      if (f.priceMin !== undefined || f.priceMax !== undefined) {
        where.basePrice = {
          ...(f.priceMin !== undefined ? { gte: f.priceMin } : {}),
          ...(f.priceMax !== undefined ? { lte: f.priceMax } : {}),
        };
      }
      // "On sale now" = a standing salePrice OR a live flash deal. Expired flash
      // deals are excluded by onSaleWhere, so they drop off automatically.
      if (f.onSale) where.OR = onSaleWhere(now).OR;
      if (f.inStock) {
        where.variants = { some: { isActive: true, stock: { gt: 0 } } };
      }
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      f?.sort === 'price_asc'
        ? { basePrice: 'asc' }
        : f?.sort === 'price_desc'
          ? { basePrice: 'desc' }
          : f?.sort === 'name'
            ? { name: 'asc' }
            : { createdAt: 'desc' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: cardSelect,
        orderBy,
        skip: params.skip,
        take: params.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items: rows.map((r) => toCard(r, now)), total };
  }

  /**
   * Min/max regular (list) price across the active catalog, optionally scoped to
   * a category. Used to seed the storefront price-range slider. Returns whole ৳
   * (floor/ceil) and guarantees max > min so the slider is always usable.
   */
  async priceBounds(categoryId?: string): Promise<{ min: number; max: number }> {
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      publishedAt: { not: null },
      ...(categoryId
        ? { categories: { some: { categoryId } } }
        : {}),
    };
    const agg = await this.prisma.product.aggregate({
      where,
      _min: { basePrice: true },
      _max: { basePrice: true },
    });
    const min = agg._min.basePrice ? Math.floor(Number(agg._min.basePrice)) : 0;
    const max = agg._max.basePrice ? Math.ceil(Number(agg._max.basePrice)) : 0;
    return { min, max: max > min ? max : min + 1 };
  }

  /** Featured products for the storefront feature section (admin-ordered). */
  async featured(limit = 8): Promise<ProductCard[]> {
    const rows = await this.prisma.product.findMany({
      where: { isActive: true, isFeatured: true, publishedAt: { not: null } },
      select: cardSelect,
      orderBy: [{ featuredOrder: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map((r) => toCard(r, new Date()));
  }

  /** Full product detail for the storefront PDP. Returns null if not found/inactive. */
  async getActiveBySlug(slug: string) {
    return this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        shortDescription: true,
        description: true,
        brand: true,
        condition: true,
        basePrice: true,
        salePrice: true,
        flashPrice: true,
        flashStartAt: true,
        flashEndAt: true,
        currency: true,
        seoTitle: true,
        seoDescription: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
          select: { url: true, alt: true, width: true, height: true },
        },
        variants: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            salePrice: true,
            stock: true,
            lowStockThreshold: true,
            attributeValues: {
              select: {
                attributeValue: {
                  select: {
                    value: true,
                    attribute: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        categories: {
          select: { category: { select: { name: true, slug: true } } },
        },
        reviews: {
          where: { isApproved: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            authorName: true,
            rating: true,
            title: true,
            body: true,
            createdAt: true,
          },
        },
      },
    });
  }
}

export function toCard(row: CardRow, now: Date = new Date()): ProductCard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    currency: row.currency,
    image: row.images[0] ?? null,
    inStock: row.variants.some((v) => v.stock > 0),
    pricing: productPriceView(resolveProductPricing(row, now)),
    flashEndsAt: isFlashActive(row, now) ? row.flashEndAt : null,
  };
}
