import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ToTrimmed } from '../../common/transforms';

export class RegisterDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  name!: string;

  @IsEmail() @MaxLength(191)
  email!: string;

  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) @MaxLength(200)
  password!: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(191)
  email!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  password!: string;
}

export class VerifyDto {
  @IsEmail() @MaxLength(191)
  email!: string;

  @IsString() @Length(6, 6, { message: 'Enter the 6-digit code' })
  code!: string;
}

export class EmailOnlyDto {
  @IsEmail() @MaxLength(191)
  email!: string;
}

export class ResetDto {
  @IsEmail() @MaxLength(191)
  email!: string;

  @IsString() @Length(6, 6)
  code!: string;

  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsOptional() @IsString() @MaxLength(200)
  currentPassword?: string;

  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) @MaxLength(200)
  newPassword!: string;
}

// Step 1 of the logged-in password change: validate current password + email a code.
export class RequestPasswordChangeDto {
  @IsOptional() @IsString() @MaxLength(200)
  currentPassword?: string;
}

// Step 2: confirm with the emailed 6-digit code + the new password.
export class ConfirmPasswordChangeDto {
  @IsOptional() @IsString() @MaxLength(200)
  currentPassword?: string;

  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' }) @MaxLength(200)
  newPassword!: string;

  @IsString() @Length(6, 6, { message: 'Enter the 6-digit code' })
  code!: string;
}

export class ProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  name!: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(32)
  phone?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(255)
  addressLine1?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(120)
  city?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(120)
  district?: string;

  @IsOptional() @ToTrimmed() @IsString() @MaxLength(32)
  postalCode?: string;
}
