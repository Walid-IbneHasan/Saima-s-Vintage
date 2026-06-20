import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface NavCategory {
  name: string;
  slug: string;
  children: { name: string; slug: string }[];
}

/**
 * Supplies the header/footer category menu. Holds a small in-memory cache
 * (categories change rarely) refreshed lazily in the background, so it can be
 * read synchronously from a Nunjucks global without a per-request DB query.
 */
@Injectable()
export class CategoryNavService implements OnModuleInit {
  private cache: NavCategory[] = [];
  private fetchedAt = 0;
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      /* DB may be down at boot; getCached() will retry later */
    }
  }

  getCached(): NavCategory[] {
    if (Date.now() - this.fetchedAt > this.ttlMs) {
      this.fetchedAt = Date.now(); // claim first to avoid a refresh stampede
      void this.refresh().catch(() => undefined);
    }
    return this.cache;
  }

  async refresh(): Promise<void> {
    this.cache = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        name: true,
        slug: true,
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { name: true, slug: true },
        },
      },
    });
    this.fetchedAt = Date.now();
  }
}
