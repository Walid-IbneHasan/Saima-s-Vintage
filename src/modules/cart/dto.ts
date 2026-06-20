import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ToNumber } from '../../common/transforms';

export class AddToCartDto {
  @IsString() @IsNotEmpty()
  variantId!: string;

  @ToNumber() @IsInt() @Min(1)
  quantity = 1;
}

export class UpdateCartItemDto {
  @ToNumber() @IsInt() @Min(0)
  quantity!: number;
}
