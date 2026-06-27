import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ToTrimmed } from '../../common/transforms';

export type PaymentMethod = 'cod' | 'bkash';

export class CheckoutDto {
  @IsEmail()
  email!: string;

  // How the customer wants to pay: Cash on Delivery or bKash online checkout.
  @IsIn(['cod', 'bkash'], { message: 'Choose a payment method.' })
  paymentMethod!: PaymentMethod;

  @IsString() @IsNotEmpty({ message: 'Phone number is required' }) @MaxLength(32)
  phone!: string;

  @IsString() @IsNotEmpty() @MaxLength(191)
  shipName!: string;

  // Optional: the single contact `phone` is used as the shipping phone too.
  @IsOptional() @IsString() @MaxLength(32)
  shipPhone?: string;

  @IsString() @IsNotEmpty()
  shipLine1!: string;

  @IsOptional() @IsString()
  shipLine2?: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  shipCity!: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(120)
  shipDistrict?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(32)
  shipPostalCode?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(120)
  shipCountry?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(64)
  couponCode?: string;

  @IsOptional() @IsString() @MaxLength(191)
  idempotencyKey?: string;
}
