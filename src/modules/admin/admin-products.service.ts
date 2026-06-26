import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PageParams } from '../../common/pagination';
import { sanitizeRichText, stripHtml } from '../../common/sanitize';
import { uniqueSlug } from '../../common/slug.util';
import { RedirectService } from '../catalog/redirect.service';
import { ProductDto, VariantDto } from './dto';

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redirects: RedirectService,
  ) {}

  async list(params: PageParams) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          basePrice: true,
          salePrice: true,
          currency: true,
          isActive: true,
          isFeatured: true,
          featuredOrder: true,
          images: {
            take: 1,
            orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
            select: { url: true },
          },
          variants: { select: { stock: true } },
        },
      }),
      this.prisma.product.count(),
    ]);

    const shaped = items.map((p) => ({
      ...p,
      image: p.images[0] ?? null,
      variantCount: p.variants.length,
      totalStock: p.variants.reduce((s, v) => s + v.stock, 0),
    }));
    return { items: shaped, total };
  }

  getForEdit(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          orderBy: { position: 'asc' },
          include: { images: { take: 1, orderBy: { position: 'asc' } } },
        },
        // Gallery images only (per-variant images live on each variant above).
        images: {
          where: { variantId: null },
          orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
        },
        categories: { select: { categoryId: true } },
      },
    });
  }

  async create(dto: ProductDto): Promise<string> {
    const slug = await this.resolveSlug(dto.slug || dto.name);
    const product = await this.createOrFail(() =>
      this.prisma.product.create({
        data: {
          ...this.scalarData(dto, slug),
          categories: dto.categoryIds.length
            ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) }
            : undefined,
          // Every product gets one default variant so it's immediately sellable
          // and has somewhere to hold stock. The admin can rename it or add more
          // (size/colour) options afterwards.
          variants: {
            create: {
              name: 'Default',
              sku: dto.sku || slug,
              stock: dto.stock ?? 0,
              lowStockThreshold: 3,
              isActive: true,
            },
          },
        },
        select: { id: true },
      }),
    );
    return product.id;
  }

  async update(id: string, dto: ProductDto): Promise<void> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!existing) throw new NotFoundException('Product not found');

    const slug = await this.resolveSlug(dto.slug || dto.name, id);

    await this.createOrFail(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.categoryProduct.deleteMany({ where: { productId: id } });
        await tx.product.update({
          where: { id },
          data: {
            ...this.scalarData(dto, slug),
            categories: dto.categoryIds.length
              ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) }
              : undefined,
          },
        });
      }),
    );

    if (existing.slug !== slug) {
      await this.redirects.record(`/p/${existing.slug}`, `/p/${slug}`);
    }
  }

  async remove(id: string): Promise<void> {
    await this.prisma.product.delete({ where: { id } });
  }

  // --- Variants -----------------------------------------------------------

  async addVariant(productId: string, dto: VariantDto): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.createOrFail(() =>
      this.prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          name: dto.name,
          size: dto.size ?? null,
          color: dto.color ?? null,
          price: dto.price ?? null,
          salePrice: dto.salePrice ?? null,
          stock: dto.stock,
          lowStockThreshold: dto.lowStockThreshold ?? 3,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async updateVariant(variantId: string, dto: VariantDto): Promise<void> {
    await this.createOrFail(() =>
      this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          sku: dto.sku,
          name: dto.name,
          size: dto.size ?? null,
          color: dto.color ?? null,
          price: dto.price ?? null,
          salePrice: dto.salePrice ?? null,
          stock: dto.stock,
          lowStockThreshold: dto.lowStockThreshold ?? 3,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async removeVariant(variantId: string): Promise<void> {
    await this.prisma.productVariant.delete({ where: { id: variantId } });
  }

  /** Set (replacing any existing) the single image shown for a variant. */
  async setVariantImage(
    productId: string,
    variantId: string,
    url: string,
  ): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    // Update-in-place when an image already exists, else create — avoids the
    // deleteMany+create transaction that could deadlock under MySQL gap locks.
    await this.createOrFail(async () => {
      const existing = await this.prisma.productImage.findFirst({
        where: { productId, variantId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (existing) {
        return this.prisma.productImage.update({
          where: { id: existing.id },
          data: { url },
        });
      }
      return this.prisma.productImage.create({
        data: { productId, variantId, url, position: 0, isPrimary: false },
      });
    });
  }

  async removeVariantImage(productId: string, variantId: string): Promise<void> {
    await this.prisma.productImage.deleteMany({ where: { productId, variantId } });
  }

  // --- Images -------------------------------------------------------------

  // The product gallery is the set of images with no variant (variantId null).
  // Per-variant images live separately and are managed via setVariantImage.
  async addImage(productId: string, url: string): Promise<void> {
    const count = await this.prisma.productImage.count({
      where: { productId, variantId: null },
    });
    await this.prisma.productImage.create({
      data: { productId, variantId: null, url, position: count, isPrimary: count === 0 },
    });
  }

  async removeImage(productId: string, imageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      const rest = await tx.productImage.findMany({
        where: { productId, variantId: null },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await this.persistOrder(tx, rest.map((i) => i.id));
    });
  }

  /** Make a gallery image the thumbnail by moving it to the front of the order. */
  async setPrimaryImage(productId: string, imageId: string): Promise<void> {
    const imgs = await this.prisma.productImage.findMany({
      where: { productId, variantId: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!imgs.some((i) => i.id === imageId)) {
      throw new NotFoundException('Image not found');
    }
    const ordered = [imageId, ...imgs.filter((i) => i.id !== imageId).map((i) => i.id)];
    await this.prisma.$transaction((tx) => this.persistOrder(tx, ordered));
  }

  /** Nudge a gallery image one slot earlier/later in the order. */
  async moveImage(productId: string, imageId: string, dir: 'up' | 'down'): Promise<void> {
    const imgs = await this.prisma.productImage.findMany({
      where: { productId, variantId: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const idx = imgs.findIndex((i) => i.id === imageId);
    if (idx < 0) throw new NotFoundException('Image not found');
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= imgs.length) return; // already at the end
    const ids = imgs.map((i) => i.id);
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    await this.prisma.$transaction((tx) => this.persistOrder(tx, ids));
  }

  /** Write positions 0..n and mark the first one primary (the thumbnail). */
  private async persistOrder(
    tx: Prisma.TransactionClient,
    orderedIds: string[],
  ): Promise<void> {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await tx.productImage.update({
        where: { id: orderedIds[i] },
        data: { position: i, isPrimary: i === 0 },
      });
    }
  }

  // --- Helpers ------------------------------------------------------------

  /** Parse an optional datetime-local string to a Date, or null. */
  private parseDate(value: string | undefined, label: string): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return d;
  }

  private scalarData(dto: ProductDto, slug: string): Prisma.ProductCreateInput {
    const flashPrice = dto.flashPrice ?? null;
    const flashStartAt = this.parseDate(dto.flashStartAt, 'flash deal start time');
    const flashEndAt = this.parseDate(dto.flashEndAt, 'flash deal end time');
    if (flashPrice != null && flashEndAt == null) {
      throw new BadRequestException('A flash deal needs an end time.');
    }
    if (flashStartAt && flashEndAt && flashStartAt >= flashEndAt) {
      throw new BadRequestException('Flash deal end time must be after the start time.');
    }

    return {
      name: dto.name,
      slug,
      sku: dto.sku ?? null,
      shortDescription: stripHtml(dto.shortDescription).slice(0, 500) || null,
      description: sanitizeRichText(dto.description) || null,
      basePrice: dto.basePrice,
      salePrice: dto.salePrice ?? null,
      flashPrice,
      flashStartAt,
      flashEndAt,
      currency: dto.currency || 'BDT',
      isActive: dto.isActive,
      isFeatured: dto.isFeatured,
      featuredOrder: dto.featuredOrder ?? 0,
      allowBackorder: dto.allowBackorder,
      minPerOrder: dto.minPerOrder ?? 1,
      maxPerOrder: dto.maxPerOrder ?? null,
      seoTitle: dto.seoTitle ?? null,
      seoDescription: dto.seoDescription ?? null,
      publishedAt: dto.isActive ? new Date() : null,
    };
  }

  private resolveSlug(base: string, excludeId?: string): Promise<string> {
    return uniqueSlug(base, async (candidate) => {
      const found = await this.prisma.product.findFirst({
        where: {
          slug: candidate,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });
      return found !== null;
    });
  }

  /**
   * Run a Prisma write with friendly error mapping: duplicate keys → 400,
   * missing records → 404, and transient write-conflicts/deadlocks (P2034) are
   * retried a few times with a short backoff before giving up.
   */
  private async createOrFail<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // Transient: MySQL write conflict / deadlock — retry up to 3 times.
        if (e.code === 'P2034' && attempt < 3) {
          await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
          return this.createOrFail(fn, attempt + 1);
        }
        if (e.code === 'P2002') {
          const target = Array.isArray(e.meta?.target)
            ? (e.meta?.target as string[]).join(', ')
            : String(e.meta?.target ?? 'value');
          const field = /sku/i.test(target) ? 'SKU' : target;
          throw new BadRequestException(
            `That ${field} is already in use — please choose a different one.`,
          );
        }
        if (e.code === 'P2025') {
          throw new NotFoundException(
            'That item no longer exists — refresh the page and try again.',
          );
        }
      }
      throw e;
    }
  }
}
