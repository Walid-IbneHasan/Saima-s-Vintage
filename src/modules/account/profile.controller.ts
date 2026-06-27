import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { buildPageMeta, parsePage } from '../../common/pagination';
import {
  AuthCustomer,
  CurrentCustomer,
} from '../../common/decorators/current-customer.decorator';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UploadsService,
} from '../admin/uploads.service';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import {
  ConfirmPasswordChangeDto,
  ProfileDto,
  RequestPasswordChangeDto,
} from '../customer-auth/dto';
import { AccountService } from './account.service';

@Controller('account')
@UseGuards(CustomerAuthGuard)
export class ProfileController {
  constructor(
    private readonly account: AccountService,
    private readonly auth: CustomerAuthService,
    private readonly uploads: UploadsService,
  ) {}

  @Get()
  async profile(
    @CurrentCustomer() me: AuthCustomer,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const { customer, hasPassword, address } = await this.account.getProfile(me.id);
    const recentOrders = await this.account.recentOrders(me.id, 3);
    res.render('account/profile', {
      title: 'My account',
      customer,
      hasPassword,
      address,
      recentOrders,
      welcome: q.welcome === '1',
      saved: q.saved === '1',
      pwSaved: q.pw === '1',
    });
  }

  /** Full order history. */
  @Get('orders')
  async orders(
    @CurrentCustomer() me: AuthCustomer,
    @Query('page') page: string,
    @Res() res: Response,
  ): Promise<void> {
    const params = parsePage(page, undefined, 10, 50);
    const { items, total } = await this.account.listOrders(me.id, params);
    res.render('account/orders', {
      title: 'My orders',
      orders: items,
      meta: buildPageMeta(params.page, params.limit, total),
      basePath: '/account/orders?',
    });
  }

  /** A single order's detail, scoped to the signed-in customer. */
  @Get('orders/:orderNumber')
  async orderDetail(
    @CurrentCustomer() me: AuthCustomer,
    @Param('orderNumber') orderNumber: string,
    @Res() res: Response,
  ): Promise<void> {
    const order = await this.account.getOrder(me.id, orderNumber);
    if (!order) throw new NotFoundException('Order not found');
    res.render('account/order-detail', {
      title: `Order ${order.orderNumber}`,
      order,
    });
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        // Allow the empty submit (no avatar chosen) through.
        if (!file || UPLOAD_ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Only image uploads are allowed'), false);
      },
    }),
  )
  async update(
    @CurrentCustomer() me: AuthCustomer,
    @Body() dto: ProfileDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ): Promise<void> {
    let imageUrl: string | undefined;
    if (file?.buffer?.length) {
      ({ url: imageUrl } = await this.uploads.saveAvatar(file));
    }
    await this.account.updateProfile(me.id, dto, imageUrl);
    res.redirect('/account?saved=1');
  }

  /** Step 1: validate current password and email a verification code. */
  @Post('password/request')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async requestPasswordChange(
    @CurrentCustomer() me: AuthCustomer,
    @Body() dto: RequestPasswordChangeDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.auth.requestPasswordChangeOtp(me.id, dto.currentPassword);
      await this.renderProfile(me.id, res, 200, { pwOtpStage: 'confirm', pwSent: true });
    } catch (e) {
      await this.renderProfile(me.id, res, 400, { pwError: (e as Error).message });
    }
  }

  /** Step 2: verify the code (+ current password) and set the new password. */
  @Post('password')
  async changePassword(
    @CurrentCustomer() me: AuthCustomer,
    @Body() dto: ConfirmPasswordChangeDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.auth.changePasswordWithOtp(
        me.id,
        dto.currentPassword,
        dto.newPassword,
        dto.code,
      );
      res.redirect('/account?pw=1');
    } catch (e) {
      await this.renderProfile(me.id, res, 400, {
        pwError: (e as Error).message,
        pwOtpStage: 'confirm',
      });
    }
  }

  /** Re-render the account page in its current state (shared by both password steps). */
  private async renderProfile(
    meId: string,
    res: Response,
    status: number,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const { customer, hasPassword, address } = await this.account.getProfile(meId);
    res.status(status).render('account/profile', {
      title: 'My account',
      customer,
      hasPassword,
      address,
      ...extra,
    });
  }
}
