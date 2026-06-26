import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ToArray, ToBool, ToNumber, ToTrimmed } from '../../common/transforms';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  email!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  password!: string;
}

export class ProductDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  name!: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(191)
  slug?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(191)
  sku?: string;

  @IsOptional() @IsString() @MaxLength(500)
  shortDescription?: string;

  @IsOptional() @IsString()
  description?: string;

  @ToNumber() @IsNumber() @Min(0)
  basePrice!: number;

  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  salePrice?: number;

  // Flash deal: a time-bound discounted price. flashEndAt is required when
  // flashPrice is set (enforced in the service).
  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  flashPrice?: number;

  @IsOptional() @ToTrimmed() @IsString()
  flashStartAt?: string;

  @IsOptional() @ToTrimmed() @IsString()
  flashEndAt?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(8)
  currency?: string;

  @ToBool() @IsBoolean()
  isActive = false;

  @ToBool() @IsBoolean()
  isFeatured = false;

  @IsOptional() @ToNumber() @IsInt() @Min(0)
  featuredOrder?: number;

  @ToBool() @IsBoolean()
  allowBackorder = false;

  @IsOptional() @ToNumber() @IsInt() @Min(1)
  minPerOrder?: number;

  @IsOptional() @ToNumber() @IsInt() @Min(1)
  maxPerOrder?: number;

  // Initial stock for the auto-created default variant (simple products).
  // Only used on create; on edit, stock is managed per variant.
  @IsOptional() @ToNumber() @IsInt() @Min(0)
  stock?: number;

  @IsOptional() @IsString() @MaxLength(191)
  seoTitle?: string;

  @IsOptional() @IsString() @MaxLength(300)
  seoDescription?: string;

  @ToArray() @IsArray()
  categoryIds: string[] = [];
}

export class VariantDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  sku!: string;

  @IsString() @IsNotEmpty() @MaxLength(191)
  name!: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(64)
  size?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(64)
  color?: string;

  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  price?: number;

  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  salePrice?: number;

  @ToNumber() @IsInt() @Min(0)
  stock!: number;

  @IsOptional() @ToNumber() @IsInt() @Min(0)
  lowStockThreshold?: number;

  @ToBool() @IsBoolean()
  isActive = true;
}

export class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  name!: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(191)
  slug?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @ToTrimmed() @IsString()
  parentId?: string;

  @ToBool() @IsBoolean()
  isActive = false;

  @IsOptional() @ToNumber() @IsInt()
  sortOrder?: number;
}

export class CouponDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  code!: string;

  @IsIn(['PERCENT', 'FIXED'])
  type!: 'PERCENT' | 'FIXED';

  @ToNumber() @IsNumber() @Min(0)
  value!: number;

  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  minSubtotal?: number;

  @IsOptional() @ToNumber() @IsNumber() @Min(0)
  maxDiscount?: number;

  @IsOptional() @ToNumber() @IsInt() @Min(1)
  usageLimit?: number;

  @IsOptional() @ToNumber() @IsInt() @Min(1)
  usageLimitPerCustomer?: number;

  @IsOptional() @ToTrimmed() @IsString()
  startsAt?: string;

  @IsOptional() @ToTrimmed() @IsString()
  expiresAt?: string;

  @ToBool() @IsBoolean()
  isActive = true;
}
