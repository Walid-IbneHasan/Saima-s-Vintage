import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VerificationType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import {
  CustomerAuthService,
  EmailNotVerifiedError,
} from './customer-auth.service';
import { EmailOnlyDto, LoginDto, RegisterDto, ResetDto, VerifyDto } from './dto';

const COOKIE = 'sv_customer';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

@Controller()
@Throttle({ default: { limit: 15, ttl: 60_000 } })
export class CustomerAuthController {
  private readonly logger = new Logger(CustomerAuthController.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(private readonly auth: CustomerAuthService) {}

  private get googleEnabled(): boolean {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  /**
   * The OAuth redirect URI. Uses GOOGLE_CALLBACK_URL if set, otherwise derives
   * it from APP_URL — so production only needs APP_URL=https://saimasvintage.com.
   * Must exactly match a redirect URI registered in the Google Cloud console.
   */
  private get callbackUrl(): string {
    return (
      process.env.GOOGLE_CALLBACK_URL ||
      `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/auth/google/callback`
    );
  }

  private setAuthCookie(res: Response, token: string): void {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProd,
      maxAge: SEVEN_DAYS,
      path: '/',
    });
  }

  // ── Register ──────────────────────────────────────────────────────────────

  @Get('register')
  registerForm(@Req() req: Request, @Res() res: Response): void {
    if (req.cookies?.[COOKIE]) return res.redirect('/account');
    res.render('auth/register', { title: 'Create account', googleEnabled: this.googleEnabled });
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res() res: Response): Promise<void> {
    try {
      const { customer } = await this.auth.register(dto.name, dto.email, dto.password);
      res.redirect(`/verify?email=${encodeURIComponent(customer.email)}&sent=1`);
    } catch (e) {
      res.status(400).render('auth/register', {
        title: 'Create account',
        error: (e as Error).message,
        values: { name: dto.name, email: dto.email },
        googleEnabled: this.googleEnabled,
      });
    }
  }

  // ── Verify email ────────────────────────────────────────────────────────────

  @Get('verify')
  verifyForm(@Query('email') email: string, @Query() q: Record<string, string>, @Res() res: Response): void {
    res.render('auth/verify', {
      title: 'Verify your email',
      email: email ?? '',
      sent: q.sent === '1',
      resent: q.resent === '1',
      needVerify: q.needverify === '1',
    });
  }

  @Post('verify')
  async verify(@Body() dto: VerifyDto, @Res() res: Response): Promise<void> {
    try {
      const customer = await this.auth.verifyOtp(dto.email, dto.code, VerificationType.EMAIL_VERIFY);
      this.setAuthCookie(res, this.auth.issueToken(customer));
      res.redirect('/account?welcome=1');
    } catch (e) {
      res.status(400).render('auth/verify', {
        title: 'Verify your email',
        email: dto.email,
        error: (e as Error).message,
      });
    }
  }

  @Post('verify/resend')
  async resend(@Body() dto: EmailOnlyDto, @Res() res: Response): Promise<void> {
    try {
      await this.auth.resendOtp(dto.email, VerificationType.EMAIL_VERIFY);
      res.redirect(`/verify?email=${encodeURIComponent(dto.email)}&resent=1`);
    } catch (e) {
      res.status(400).render('auth/verify', {
        title: 'Verify your email',
        email: dto.email,
        error: (e as Error).message,
      });
    }
  }

  // ── Login / logout ──────────────────────────────────────────────────────────

  @Get('login')
  loginForm(@Req() req: Request, @Query() q: Record<string, string>, @Res() res: Response): void {
    if (req.cookies?.[COOKIE]) return res.redirect('/account');
    res.render('auth/login', {
      title: 'Log in',
      googleEnabled: this.googleEnabled,
      reset: q.reset === '1',
      oauthError: q.error === 'oauth',
    });
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res() res: Response): Promise<void> {
    try {
      const customer = await this.auth.login(dto.email, dto.password);
      this.setAuthCookie(res, this.auth.issueToken(customer));
      res.redirect('/account');
    } catch (e) {
      if (e instanceof EmailNotVerifiedError) {
        res.redirect(`/verify?email=${encodeURIComponent(dto.email)}&needverify=1`);
        return;
      }
      res.status(401).render('auth/login', {
        title: 'Log in',
        error: 'Invalid email or password.',
        values: { email: dto.email },
        googleEnabled: this.googleEnabled,
      });
    }
  }

  @Post('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/');
  }

  // ── Forgot / reset password ─────────────────────────────────────────────────

  @Get('forgot')
  forgotForm(@Res() res: Response): void {
    res.render('auth/forgot', { title: 'Forgot password' });
  }

  @Post('forgot')
  async forgot(@Body() dto: EmailOnlyDto, @Res() res: Response): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
    res.redirect(`/reset?email=${encodeURIComponent(dto.email)}&sent=1`);
  }

  @Get('reset')
  resetForm(@Query('email') email: string, @Query() q: Record<string, string>, @Res() res: Response): void {
    res.render('auth/reset', { title: 'Reset password', email: email ?? '', sent: q.sent === '1' });
  }

  @Post('reset')
  async reset(@Body() dto: ResetDto, @Res() res: Response): Promise<void> {
    try {
      await this.auth.resetPassword(dto.email, dto.code, dto.password);
      res.redirect('/login?reset=1');
    } catch (e) {
      res.status(400).render('auth/reset', {
        title: 'Reset password',
        email: dto.email,
        error: (e as Error).message,
      });
    }
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────────

  @Get('auth/google')
  googleStart(@Res() res: Response): void {
    if (!this.googleEnabled) return res.redirect('/login');
    const state = randomBytes(16).toString('hex');
    res.cookie('sv_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProd,
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
    url.searchParams.set('redirect_uri', this.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    res.redirect(url.toString());
  }

  @Get('auth/google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.googleEnabled) return res.redirect('/login');
    const saved = req.cookies?.sv_oauth_state as string | undefined;
    res.clearCookie('sv_oauth_state', { path: '/' });
    if (!code || !state || state !== saved) {
      return res.redirect('/login?error=oauth');
    }
    try {
      const accessToken = await this.exchangeGoogleCode(code);
      const profile = await this.fetchGoogleProfile(accessToken);
      const customer = await this.auth.googleUpsert({
        googleId: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      });
      this.setAuthCookie(res, this.auth.issueToken(customer));
      res.redirect('/account');
    } catch (e) {
      this.logger.error('Google OAuth failed', e as Error);
      res.redirect('/login?error=oauth');
    }
  }

  private async exchangeGoogleCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: this.callbackUrl,
      grant_type: 'authorization_code',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('No access token from Google');
    return json.access_token;
  }

  private async fetchGoogleProfile(accessToken: string): Promise<{
    sub: string;
    email: string;
    name: string;
    picture?: string;
  }> {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };
    if (!json.sub || !json.email) throw new Error('Incomplete Google profile');
    return { sub: json.sub, email: json.email, name: json.name ?? '', picture: json.picture };
  }
}
