import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AuthCustomer,
  CurrentCustomer,
} from '../../common/decorators/current-customer.decorator';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ReviewDto } from './dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('p/:slug/reviews')
  @UseGuards(CustomerAuthGuard)
  async create(
    @Param('slug') slug: string,
    @Body() dto: ReviewDto,
    @CurrentCustomer() me: AuthCustomer,
    @Res() res: Response,
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    try {
      await this.reviews.create(me.id, me.name, product.id, dto.rating, dto.title, dto.body);
      res.redirect(`/p/${slug}#reviews`);
    } catch (e) {
      res.redirect(
        `/p/${slug}?reviewError=${encodeURIComponent((e as Error).message)}#reviews`,
      );
    }
  }
}
