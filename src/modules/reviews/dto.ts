import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToNumber } from '../../common/transforms';

export class ReviewDto {
  @ToNumber() @IsInt() @Min(1) @Max(5)
  rating!: number;

  @IsOptional() @IsString() @MaxLength(191)
  title?: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  body!: string;
}
