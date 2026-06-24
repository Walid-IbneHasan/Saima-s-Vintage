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
        variants: { orderBy: { position: 'asc' } },
        images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] },
        categories: { select: { categoryId: true } },
      },
    });
  }

  async create(dto: ProductDto): Promise<string> {
    const slug = await this.resolveSlug(dto.slug || dto.name);
    const product = await this.prisma.product.create({
      data: {
        ...this.scalarData(dto, slug),
        categories: dto.categoryIds.length
          ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) }
          : undefined,
      },
      select: { id: true },
    });
    return product.id;
  }

  async update(id: string, dto: ProductDto): Promise<void> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!existing) throw new NotFoundException('Product not found');

    const slug = await this.resolveSlug(dto.slug || dto.name, id);

    await this.prisma.$transaction(async (tx) => {
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
    });

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

  // --- Images -------------------------------------------------------------

  async addImage(productId: string, url: string): Promise<void> {
    const count = await this.prisma.productImage.count({ where: { productId } });
    await this.prisma.productImage.create({
      data: { productId, url, position: count, isPrimary: count === 0 },
    });
  }

  async removeImage(imageId: string): Promise<void> {
    await this.prisma.productImage.delete({ where: { id: imageId } });
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
      brand: dto.brand ?? null,
      condition: dto.condition ?? null,
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

  /** Map Prisma unique-constraint errors (e.g. duplicate SKU) to 400s. */
  private async createOrFail<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('SKU already exists');
      }
      throw e;
    }
  }
}
