import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminDashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async dashboard(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const [products, categories, orders, lowStock] =
      await this.prisma.$transaction([
        this.prisma.product.count(),
        this.prisma.category.count(),
        this.prisma.order.count(),
        this.prisma.productVariant.count({ where: { stock: { lte: 3 } } }),
      ]);

    res.render('admin/dashboard', {
      title: 'Dashboard',
      user,
      stats: { products, categories, orders, lowStock },
    });
  }
}
