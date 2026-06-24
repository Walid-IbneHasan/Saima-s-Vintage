import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { buildPageMeta, parsePage } from '../../common/pagination';
import {
  isFlashActive,
  productPriceView,
  resolveProductPricing,
} from '../../common/pricing';
import {
  filterQueryString,
  parseProductFilters,
} from '../../common/product-filters';
import { ReviewsService } from '../reviews/reviews.service';
import { SeoService } from '../seo/seo.service';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';
import { RedirectService } from './redirect.service';
import { SearchService } from './search.service';

@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly search: SearchService,
    private readonly redirects: RedirectService,
    private readonly seo: SeoService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('products')
  async shop(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const pageParams = parsePage(query.page);
    const filters = parseProductFilters(query);
    const [{ items, total }, bounds] = await Promise.all([
      this.products.listActive(pageParams, { filters }),
      this.products.priceBounds(),
    ]);

    res.render('pages/products', {
      title: 'Shop all',
      metaDescription: 'Browse the full collection of curated vintage pieces.',
      canonical: `${process.env.APP_URL ?? ''}/products`,
      products: items,
      meta: buildPageMeta(pageParams.page, pageParams.limit, total),
      filters,
      bounds,
      formAction: '/products',
      basePath: `/products?${filterQueryString(filters)}`,
    });
  }

  @Get('c/:slug')
  async category(
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const category = await this.categories.getActiveBySlug(slug);
    if (!category) {
      return this.redirectOr404(res, `/c/${slug}`);
    }

    const pageParams = parsePage(query.page);
    const filters = parseProductFilters(query);
    const [{ items, total }, bounds] = await Promise.all([
      this.products.listActive(pageParams, { categoryId: category.id, filters }),
      this.products.priceBounds(category.id),
    ]);

    res.render('pages/category', {
      title: category.seoTitle || category.name,
      metaDescription: category.seoDescription || category.description,
      canonical: `${process.env.APP_URL ?? ''}/c/${category.slug}`,
      category,
      products: items,
      filters,
      bounds,
      formAction: `/c/${category.slug}`,
      meta: buildPageMeta(pageParams.page, pageParams.limit, total),
      basePath: `/c/${category.slug}?${filterQueryString(filters)}`,
      jsonLd: [
        this.seo.breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          ...(category.parent
            ? [{ name: category.parent.name, path: `/c/${category.parent.slug}` }]
            : []),
          { name: category.name, path: `/c/${category.slug}` },
        ]),
      ],
    });
  }

  @Get('p/:slug')
  async product(
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const product = await this.products.getActiveBySlug(slug);
    if (!product) {
      return this.redirectOr404(res, `/p/${slug}`);
    }

    const inStock = product.variants.some((v) => v.stock > 0);

    // Review eligibility for the logged-in customer (from the JWT context).
    const cust = res.locals.currentCustomer as { id: string } | undefined;
    let canReview = false;
    let hasReviewed = false;
    if (cust) {
      [canReview, hasReviewed] = await Promise.all([
        this.reviews.canReview(cust.id, product.id),
        this.reviews.hasReviewed(cust.id, product.id),
      ]);
    }
    const reviewCount = product.reviews.length;
    const reviewStats = {
      count: reviewCount,
      average:
        reviewCount > 0
          ? Math.round(
              (product.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) *
                10,
            ) / 10
          : 0,
    };
    const firstCategory = product.categories[0]?.category;
    const crumbs = [
      { name: 'Home', path: '/' },
      ...(firstCategory
        ? [{ name: firstCategory.name, path: `/c/${firstCategory.slug}` }]
        : []),
      { name: product.name, path: `/p/${product.slug}` },
    ];

    const now = new Date();
    const flashLive = isFlashActive(product, now);

    res.render('pages/product', {
      title: product.seoTitle || product.name,
      metaDescription: product.seoDescription || product.shortDescription,
      canonical: this.seo.abs(`/p/${product.slug}`),
      ogImage: product.images[0] ? this.seo.abs(product.images[0].url) : undefined,
      product,
      pricing: productPriceView(resolveProductPricing(product, now)),
      flashEndsAt: flashLive ? product.flashEndAt : null,
      flashEndsAtMs: flashLive && product.flashEndAt ? product.flashEndAt.getTime() : null,
      reviewStats,
      canReview,
      hasReviewed,
      reviewError: query.reviewError,
      inStock,
      jsonLd: [
        this.seo.productJsonLd(product, inStock),
        this.seo.breadcrumbJsonLd(crumbs),
      ],
    });
  }

  @Get('search')
  async searchPage(
    @Query('q') q: string,
    @Query('page') page: string,
    @Res() res: Response,
  ): Promise<void> {
    const pageParams = parsePage(page);
    const { items, total, query } = await this.search.search(q ?? '', pageParams);

    res.render('pages/search', {
      title: query ? `Search: ${query}` : 'Search',
      query,
      products: items,
      meta: buildPageMeta(pageParams.page, pageParams.limit, total),
      basePath: `/search?q=${encodeURIComponent(query)}&`,
    });
  }

  private async redirectOr404(res: Response, path: string): Promise<void> {
    const target = await this.redirects.findTarget(path);
    if (target) {
      res.redirect(target.statusCode, target.toPath);
      return;
    }
    throw new NotFoundException('Page not found');
  }
}
