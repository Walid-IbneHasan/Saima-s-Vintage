import { Injectable } from '@nestjs/common';
import { PageParams } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileDto } from '../customer-auth/dto';

// Order fields shown in the account list rows (status, total, a few item names).
const orderCardSelect = {
  id: true,
  orderNumber: true,
  status: true,
  createdAt: true,
  grandTotal: true,
  currency: true,
  _count: { select: { items: true } },
  items: { take: 3, select: { productName: true, variantName: true, quantity: true } },
  payments: { take: 1, orderBy: { createdAt: 'asc' as const }, select: { provider: true } },
};

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** A few most-recent orders for the account dashboard. */
  recentOrders(customerId: string, take = 3) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take,
      select: orderCardSelect,
    });
  }

  /** Paginated full order history for the customer. */
  async listOrders(customerId: string, params: PageParams) {
    const where = { customerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
        select: orderCardSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  /** A single order, scoped to the owning customer (null if not theirs). */
  getOrder(customerId: string, orderNumber: string) {
    return this.prisma.order.findFirst({
      where: { orderNumber, customerId },
      include: {
        items: {
          include: {
            variant: {
              select: {
                images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
                product: {
                  select: {
                    slug: true,
                    images: {
                      where: { variantId: null },
                      take: 1,
                      orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
        payments: { orderBy: { createdAt: 'desc' } },
        shipments: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async getProfile(customerId: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        imageUrl: true,
        googleId: true,
        emailVerifiedAt: true,
        passwordHash: true,
        createdAt: true,
      },
    });
    const address = await this.prisma.address.findFirst({
      where: { customerId },
      orderBy: { isDefault: 'desc' },
    });
    const hasPassword = !!row?.passwordHash;
    // Strip the hash before handing to the view.
    const customer = row
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          imageUrl: row.imageUrl,
          googleId: row.googleId,
          emailVerifiedAt: row.emailVerifiedAt,
          createdAt: row.createdAt,
        }
      : null;
    return { customer, hasPassword, address };
  }

  async updateProfile(
    customerId: string,
    dto: ProfileDto,
    imageUrl?: string,
  ): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        name: dto.name,
        phone: dto.phone ?? null,
        ...(imageUrl ? { imageUrl } : {}),
      },
    });

    // Maintain a single default address from the profile form.
    if (dto.addressLine1) {
      const existing = await this.prisma.address.findFirst({
        where: { customerId, isDefault: true },
      });
      const data = {
        fullName: dto.name,
        phone: dto.phone ?? '',
        line1: dto.addressLine1,
        city: dto.city ?? '',
        district: dto.district ?? null,
        postalCode: dto.postalCode ?? null,
        country: 'Bangladesh',
        isDefault: true,
      };
      if (existing) {
        await this.prisma.address.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.address.create({ data: { ...data, customerId } });
      }
    }
  }
}
