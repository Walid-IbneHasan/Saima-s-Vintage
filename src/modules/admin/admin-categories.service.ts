import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeRichText } from '../../common/sanitize';
import { uniqueSlug } from '../../common/slug.util';
import { RedirectService } from '../catalog/redirect.service';
import { CategoryDto } from './dto';

@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redirects: RedirectService,
  ) {}

  list() {
    return this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        sortOrder: true,
        parent: { select: { name: true } },
        _count: { select: { products: true } },
      },
    });
  }

  /** Flat list for parent/category selectors. */
  listForSelect() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  getForEdit(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  async create(dto: CategoryDto): Promise<string> {
    const slug = await this.resolveSlug(dto.slug || dto.name);
    const category = await this.prisma.category.create({
      data: this.data(dto, slug),
      select: { id: true },
    });
    return category.id;
  }

  async update(id: string, dto: CategoryDto): Promise<void> {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!existing) throw new NotFoundException('Category not found');

    const slug = await this.resolveSlug(dto.slug || dto.name, id);
    await this.prisma.category.update({
      where: { id },
      data: this.data(dto, slug),
    });

    if (existing.slug !== slug) {
      await this.redirects.record(`/c/${existing.slug}`, `/c/${slug}`);
    }
  }

  async remove(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }

  private data(dto: CategoryDto, slug: string) {
    return {
      name: dto.name,
      slug,
      description: sanitizeRichText(dto.description) || null,
      parentId: dto.parentId || null,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder ?? 0,
    };
  }

  private resolveSlug(base: string, excludeId?: string): Promise<string> {
    return uniqueSlug(base, async (candidate) => {
      const found = await this.prisma.category.findFirst({
        where: {
          slug: candidate,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });
      return found !== null;
    });
  }
}
