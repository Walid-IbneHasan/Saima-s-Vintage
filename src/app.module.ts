import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { CronModule } from './modules/cron/cron.module';
import { CustomerAuthModule } from './modules/customer-auth/customer-auth.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PagesModule } from './modules/pages/pages.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SitemapModule } from './modules/sitemap/sitemap.module';
import { StorefrontModule } from './modules/storefront/storefront.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    // Global baseline rate limit; per-route stricter limits are added in
    // login/checkout/payment modules in later phases.
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    NotificationsModule,
    JobsModule,
    InventoryModule,
    HealthModule,
    CustomerAuthModule,
    AccountModule,
    StorefrontModule,
    PagesModule,
    CartModule,
    CouponsModule,
    PaymentsModule,
    CheckoutModule,
    SitemapModule,
    AnalyticsModule,
    CronModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
