import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Stateless admin auth: a signed httpOnly cookie carries the user id. The user
 * is reloaded from the DB each request so deactivating an account revokes access
 * immediately. No server-side session store (cPanel-friendly).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    const userId = req.signedCookies?.sv_admin as string | undefined;
    if (!userId) throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    req.user = user;
    return true;
  }
}
