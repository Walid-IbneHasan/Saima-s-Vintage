import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthCustomer {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  imageUrl: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
}

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthCustomer | undefined => {
    return ctx.switchToHttp().getRequest().customer;
  },
);
