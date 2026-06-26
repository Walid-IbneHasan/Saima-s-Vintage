import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { buildPageMeta, parsePage } from '../../common/pagination';
import { AdminOrdersService } from './admin-orders.service';
import { AuditService } from './audit.service';

const ORDER_STATUSES = Object.values(OrderStatus);

@Controller('admin/orders')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query('page') page: string,
    @Query('status') status: string,
    @Res() res: Response,
  ): Promise<void> {
    const params = parsePage(page, undefined, 20, 50);
    const filter = ORDER_STATUSES.includes(status as OrderStatus)
      ? (status as OrderStatus)
      : undefined;
    const { items, total } = await this.orders.list(params, filter);
    res.render('admin/orders/list', {
      title: 'Orders',
      orders: items,
      meta: buildPageMeta(params.page, params.limit, total),
      statuses: ORDER_STATUSES,
      activeStatus: filter ?? '',
      basePath: `/admin/orders?${filter ? `status=${filter}&` : ''}`,
    });
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Query('notice') notice: string,
    @Res() res: Response,
  ): Promise<void> {
    const order = await this.orders.getDetail(id);
    if (!order) throw new NotFoundException('Order not found');
    const notices: Record<string, { kind: string; text: string }> = {
      refund_ok: { kind: 'ok', text: 'Refund completed — the order has been refunded and items restocked.' },
      refund_failed: { kind: 'error', text: 'Refund failed at bKash. Nothing was changed — check the payment events.' },
    };
    res.render('admin/orders/detail', {
      title: `Order ${order.orderNumber}`,
      order,
      notice: notices[notice] ?? null,
    });
  }

  @Post(':id/processing')
  async processing(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transition(id, OrderStatus.PROCESSING, 'order.processing', u, req);
    res.redirect(`/admin/orders/${id}`);
  }

  @Post(':id/shipped')
  async shipped(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transition(id, OrderStatus.SHIPPED, 'order.shipped', u, req);
    res.redirect(`/admin/orders/${id}`);
  }

  @Post(':id/delivered')
  async delivered(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transition(id, OrderStatus.DELIVERED, 'order.delivered', u, req);
    res.redirect(`/admin/orders/${id}`);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.orders.cancel(id);
    await this.audit.log({ userId: u.id, action: 'order.cancel', entityType: 'Order', entityId: id, req });
    res.redirect(`/admin/orders/${id}`);
  }

  @Post(':id/approve-review')
  async approveReview(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.orders.approveReview(id);
    await this.audit.log({ userId: u.id, action: 'order.approve_review', entityType: 'Order', entityId: id, req });
    res.redirect(`/admin/orders/${id}`);
  }

  @Post(':id/refund')
  async refund(@Param('id') id: string, @CurrentUser() u: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.orders.refund(id);
    await this.audit.log({ userId: u.id, action: 'order.refund', entityType: 'Order', entityId: id, after: { ok: result.ok }, req });
    res.redirect(`/admin/orders/${id}?notice=${result.ok ? 'refund_ok' : 'refund_failed'}`);
  }

  private async transition(
    id: string,
    status: OrderStatus,
    action: string,
    user: AuthUser,
    req: Request,
  ): Promise<void> {
    await this.orders.markStatus(id, status);
    await this.audit.log({ userId: user.id, action, entityType: 'Order', entityId: id, after: { status }, req });
  }
}
