import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthCustomer } from '../decorators/current-customer.decorator';

/** Protects storefront customer routes via the JWT in the `sv_customer` cookie. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { customer?: AuthCustomer }>();

    const token = req.cookies?.sv_customer as string | undefined;
    if (!token) throw new UnauthorizedException();

    let sub: string;
    try {
      sub = this.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      throw new UnauthorizedException();
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: sub },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        imageUrl: true,
        isActive: true,
        emailVerifiedAt: true,
      },
    });
    if (!customer || !customer.isActive) throw new UnauthorizedException();

    req.customer = customer;
    return true;
  }
}
