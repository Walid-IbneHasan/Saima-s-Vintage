import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileDto } from '../customer-auth/dto';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

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
