import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PageParams } from '../../common/pagination';

@Injectable()
export class AdminReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: PageParams) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          authorName: true,
          rating: true,
          title: true,
          body: true,
          isApproved: true,
          createdAt: true,
          customerId: true,
          product: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.review.count(),
    ]);
    return { items, total };
  }

  async remove(id: string): Promise<void> {
    await this.prisma.review.delete({ where: { id } });
  }
}
