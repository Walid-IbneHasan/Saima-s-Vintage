import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const PURCHASED_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** True if the customer has a paid+ order containing a variant of this product. */
  async canReview(customerId: string, productId: string): Promise<boolean> {
    const count = await this.prisma.orderItem.count({
      where: {
        order: { customerId, status: { in: PURCHASED_STATUSES } },
        variant: { productId },
      },
    });
    return count > 0;
  }

  async hasReviewed(customerId: string, productId: string): Promise<boolean> {
    const count = await this.prisma.review.count({
      where: { productId, customerId },
    });
    return count > 0;
  }

  async create(
    customerId: string,
    authorName: string,
    productId: string,
    rating: number,
    title: string | undefined,
    body: string,
  ): Promise<void> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5.');
    }
    if (!(await this.canReview(customerId, productId))) {
      throw new ForbiddenException(
        'You can only review a product you have purchased.',
      );
    }
    try {
      await this.prisma.review.create({
        data: {
          productId,
          customerId,
          authorName,
          rating,
          title: title?.trim() || null,
          body: body.trim(),
          isApproved: true, // verified purchase → auto-approved
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('You have already reviewed this product.');
      }
      throw e;
    }
  }
}
