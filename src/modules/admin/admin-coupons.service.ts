import { BadRequestException, Injectable } from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponDto } from './dto';

@Injectable()
export class AdminCouponsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CouponDto): Promise<string> {
    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          type: dto.type as CouponType,
          value: dto.value,
          minSubtotal: dto.minSubtotal ?? null,
          maxDiscount: dto.maxDiscount ?? null,
          usageLimit: dto.usageLimit ?? null,
          usageLimitPerCustomer: dto.usageLimitPerCustomer ?? null,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          isActive: dto.isActive,
        },
        select: { id: true },
      });
      return coupon.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('A coupon with that code already exists');
      }
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    await this.prisma.coupon.delete({ where: { id } });
  }
}
