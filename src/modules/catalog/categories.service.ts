import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  getActiveBySlug(slug: string) {
    return this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        parent: { select: { name: true, slug: true } },
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { name: true, slug: true },
        },
      },
    });
  }

  /** Top-level active categories — used for nav/footer. */
  listTopLevel() {
    return this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true, slug: true },
    });
  }

  /** Top-level active categories with images — for the home "shop by category". */
  listTopLevelWithImages() {
    return this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true, slug: true, imageUrl: true, description: true },
    });
  }
}
