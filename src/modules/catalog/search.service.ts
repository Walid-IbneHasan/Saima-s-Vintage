import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PageParams } from '../../common/pagination';
import { ProductCard, toCard } from './products.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * MySQL FULLTEXT search in BOOLEAN MODE (prefix-matched). Boolean mode avoids
   * the 50%-of-rows quirk of NATURAL LANGUAGE MODE on small catalogs. Designed
   * so a Meilisearch/Algolia adapter can replace this later.
   */
  async search(
    rawQuery: string,
    params: PageParams,
  ): Promise<{ items: ProductCard[]; total: number; query: string }> {
    const terms = (rawQuery ?? '')
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/[+\-><()~*"@]/g, '')) // strip FULLTEXT operators
      .filter((t) => t.length > 0);

    if (terms.length === 0) {
      return { items: [], total: 0, query: rawQuery ?? '' };
    }

    const booleanExpr = terms.map((t) => `${t}*`).join(' ');

    const idRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM Product
      WHERE isActive = true
        AND MATCH(name, shortDescription) AGAINST (${booleanExpr} IN BOOLEAN MODE)
      ORDER BY MATCH(name, shortDescription) AGAINST (${booleanExpr} IN BOOLEAN MODE) DESC
      LIMIT ${params.limit} OFFSET ${params.skip}
    `);

    if (idRows.length === 0) {
      return { items: [], total: 0, query: rawQuery };
    }
    const ids = idRows.map((r) => r.id);

    const [rows, countRows] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
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
          variants: { where: { isActive: true }, select: { stock: true } },
        },
      }),
      this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS c FROM Product
        WHERE isActive = true
          AND MATCH(name, shortDescription) AGAINST (${booleanExpr} IN BOOLEAN MODE)
      `),
    ]);

    // Preserve relevance order from the FULLTEXT query.
    const orderIndex = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);

    const now = new Date();
    const items: ProductCard[] = rows.map((r) => toCard(r, now));

    return { items, total: Number(countRows[0]?.c ?? 0), query: rawQuery };
  }
}
