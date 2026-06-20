import { Module } from '@nestjs/common';
import { UploadsService } from '../admin/uploads.service';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AccountService } from './account.service';
import { ProfileController } from './profile.controller';

@Module({
  imports: [CustomerAuthModule],
  controllers: [ProfileController],
  providers: [AccountService, UploadsService],
})
export class AccountModule {}
