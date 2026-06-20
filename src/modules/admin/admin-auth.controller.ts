import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';

@Controller('admin')
export class AdminAuthController {
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(private readonly auth: AuthService) {}

  @Get('login')
  loginPage(@Req() req: Request, @Res() res: Response): void {
    if (req.signedCookies?.sv_admin) {
      res.redirect('/admin');
      return;
    }
    res.render('admin/login', { title: 'Admin Login' });
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.auth.validate(dto.email, dto.password);
    if (!user) {
      res
        .status(401)
        .render('admin/login', {
          title: 'Admin Login',
          error: 'Invalid email or password.',
          email: dto.email,
        });
      return;
    }
    res.cookie('sv_admin', user.id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.redirect('/admin');
  }

  @Post('logout')
  logout(@Res() res: Response): void {
    res.clearCookie('sv_admin', { path: '/' });
    res.redirect('/admin/login');
  }
}
