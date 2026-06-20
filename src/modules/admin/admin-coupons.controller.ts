import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminCouponsService } from './admin-coupons.service';
import { AuditService } from './audit.service';
import { CouponDto } from './dto';

@Controller('admin/coupons')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminCouponsController {
  constructor(
    private readonly coupons: AdminCouponsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Res() res: Response): Promise<void> {
    res.render('admin/coupons/list', {
      title: 'Coupons',
      coupons: await this.coupons.list(),
    });
  }

  @Get('new')
  newForm(@Res() res: Response): void {
    res.render('admin/coupons/form', { title: 'New coupon' });
  }

  @Post()
  async create(
    @Body() dto: CouponDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = await this.coupons.create(dto);
    await this.audit.log({
      userId: user.id,
      action: 'coupon.create',
      entityType: 'Coupon',
      entityId: id,
      after: { code: dto.code },
      req,
    });
    res.redirect('/admin/coupons');
  }

  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.coupons.remove(id);
    await this.audit.log({
      userId: user.id,
      action: 'coupon.delete',
      entityType: 'Coupon',
      entityId: id,
      req,
    });
    res.redirect('/admin/coupons');
  }
}
