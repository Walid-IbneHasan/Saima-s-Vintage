import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Customer, VerificationType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const DUMMY_HASH = '$2a$10$0000000000000000000000000000000000000000000000000000';

/** Raised when login is attempted on an unverified account. */
export class EmailNotVerifiedError extends Error {}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Registration + verification ─────────────────────────────────────────

  /**
   * Register a customer. If the email exists but is unverified, this RE-REGISTERS
   * (updates details + resends a code) rather than erroring — the "re-register"
   * path the user asked for. A verified email is rejected (login instead).
   */
  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<{ customer: Customer; reRegistered: boolean }> {
    const normEmail = email.toLowerCase().trim();
    const existing = await this.prisma.customer.findUnique({
      where: { email: normEmail },
    });
    const passwordHash = await bcrypt.hash(password, 10);

    if (existing?.emailVerifiedAt) {
      throw new ConflictException(
        'An account with this email already exists. Please log in.',
      );
    }

    let customer: Customer;
    let reRegistered = false;
    if (existing) {
      customer = await this.prisma.customer.update({
        where: { id: existing.id },
        data: { name, passwordHash },
      });
      reRegistered = true;
    } else {
      customer = await this.prisma.customer.create({
        data: { name, email: normEmail, passwordHash },
      });
    }

    await this.issueOtp(customer, VerificationType.EMAIL_VERIFY);
    return { customer, reRegistered };
  }

  /** Generate, store (hashed), and email a one-time code. Enforces a resend cooldown. */
  async issueOtp(customer: Customer, type: VerificationType): Promise<void> {
    const latest = await this.prisma.customerOtp.findFirst({
      where: { customerId: customer.id, type, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new BadRequestException(
        'Please wait a minute before requesting another code.',
      );
    }

    // Invalidate any prior unconsumed codes of this type.
    await this.prisma.customerOtp.updateMany({
      where: { customerId: customer.id, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = randomInt(100000, 1000000).toString();
    await this.prisma.customerOtp.create({
      data: {
        customerId: customer.id,
        type,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    const subject =
      type === VerificationType.EMAIL_VERIFY
        ? "Verify your Saima's Vintage account"
        : "Reset your Saima's Vintage password";
    await this.notifications.send(
      customer.email,
      subject,
      `<p>Your code is <strong style="font-size:20px">${code}</strong>.</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    );

    // Dev affordance: surface the code in logs when there's no real mail server.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`OTP (${type}) for ${customer.email}: ${code}`);
    }
  }

  /** Verify a code. Enforces expiry + attempt limit. Returns the customer on success. */
  async verifyOtp(
    email: string,
    code: string,
    type: VerificationType,
  ): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!customer) throw new BadRequestException('Invalid or expired code.');

    const otp = await this.prisma.customerOtp.findFirst({
      where: { customerId: customer.id, type, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'That code has expired. Please request a new one.',
      );
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      await this.prisma.customerOtp.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException(
        'Too many attempts. Please request a new code.',
      );
    }

    const ok = await bcrypt.compare(code, otp.codeHash);
    await this.prisma.customerOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 }, ...(ok ? { consumedAt: new Date() } : {}) },
    });
    if (!ok) throw new BadRequestException('Invalid code. Please try again.');

    if (type === VerificationType.EMAIL_VERIFY && !customer.emailVerifiedAt) {
      return this.prisma.customer.update({
        where: { id: customer.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    return customer;
  }

  async resendOtp(email: string, type: VerificationType): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (customer) await this.issueOtp(customer, type);
    // Silent if no such customer (anti-enumeration).
  }

  // ── Login ────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    const ok = await bcrypt.compare(password, customer?.passwordHash ?? DUMMY_HASH);
    if (!customer || !customer.isActive || !ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (!customer.emailVerifiedAt) {
      throw new EmailNotVerifiedError(customer.email);
    }
    return customer;
  }

  // ── Password reset / change ───────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    // Only send if the account can use a password; always resolve (anti-enumeration).
    if (customer && customer.passwordHash) {
      await this.issueOtp(customer, VerificationType.PASSWORD_RESET).catch(() => undefined);
    }
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const customer = await this.verifyOtp(email, code, VerificationType.PASSWORD_RESET);
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
  }

  async changePassword(
    customerId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new UnauthorizedException();

    // If the account already has a password, the current one must match.
    if (customer.passwordHash) {
      const ok = await bcrypt.compare(currentPassword ?? '', customer.passwordHash);
      if (!ok) throw new BadRequestException('Your current password is incorrect.');
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  async googleUpsert(profile: {
    googleId: string;
    email: string;
    name: string;
    picture?: string;
  }): Promise<Customer> {
    const email = profile.email.toLowerCase().trim();
    const byGoogle = await this.prisma.customer.findUnique({
      where: { googleId: profile.googleId },
    });
    if (byGoogle) return byGoogle;

    const byEmail = await this.prisma.customer.findUnique({ where: { email } });
    if (byEmail) {
      return this.prisma.customer.update({
        where: { id: byEmail.id },
        data: {
          googleId: profile.googleId,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
          imageUrl: byEmail.imageUrl ?? profile.picture ?? null,
        },
      });
    }
    return this.prisma.customer.create({
      data: {
        email,
        name: profile.name || email.split('@')[0],
        googleId: profile.googleId,
        imageUrl: profile.picture ?? null,
        emailVerifiedAt: new Date(),
      },
    });
  }

  // ── JWT ────────────────────────────────────────────────────────────────────

  issueToken(customer: Customer): string {
    return this.jwt.sign({ sub: customer.id, name: customer.name, email: customer.email });
  }
}
