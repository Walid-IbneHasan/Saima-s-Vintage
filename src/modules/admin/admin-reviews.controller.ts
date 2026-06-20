import {
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import { buildPageMeta, parsePage } from '../../common/pagination';
import { AdminReviewsService } from './admin-reviews.service';
import { AuditService } from './audit.service';

@Controller('admin/reviews')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class AdminReviewsController {
  constructor(
    private readonly reviews: AdminReviewsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('page') page: string, @Res() res: Response): Promise<void> {
    const params = parsePage(page, undefined, 20, 50);
    const { items, total } = await this.reviews.list(params);
    res.render('admin/reviews/list', {
      title: 'Reviews',
      reviews: items,
      meta: buildPageMeta(params.page, params.limit, total),
      basePath: '/admin/reviews?',
    });
  }

  @Post(':id/delete')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.reviews.remove(id);
    await this.audit.log({
      userId: user.id,
      action: 'review.delete',
      entityType: 'Review',
      entityId: id,
      req,
    });
    res.redirect('/admin/reviews');
  }
}
