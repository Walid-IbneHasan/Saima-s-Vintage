import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminCouponsController } from './admin-coupons.controller';
import { AdminCouponsService } from './admin-coupons.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { AdminFormExceptionFilter } from './admin-form-exception.filter';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminReviewsService } from './admin-reviews.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersFormFilter } from './admin-users-form.filter';
import { AuditService } from './audit.service';
import { AuthService } from './auth.service';
import { UploadsService } from './uploads.service';

@Module({
  imports: [CatalogModule, AnalyticsModule, PaymentsModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminProductsController,
    AdminCategoriesController,
    AdminCouponsController,
    AdminOrdersController,
    AdminReviewsController,
    AdminAnalyticsController,
    AdminUsersController,
  ],
  providers: [
    AuthService,
    AuditService,
    UploadsService,
    AdminProductsService,
    AdminCategoriesService,
    AdminCouponsService,
    AdminOrdersService,
    AdminReviewsService,
    AdminUsersService,
    AdminFormExceptionFilter,
    AdminUsersFormFilter,
    SessionAuthGuard,
    RolesGuard,
  ],
})
export class AdminModule {}
