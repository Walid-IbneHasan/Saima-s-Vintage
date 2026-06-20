import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the user on valid credentials, else null. Constant-ish time. */
  async validate(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Always run a compare to reduce user-enumeration timing signal.
    const hash =
      user?.passwordHash ??
      '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !user.isActive || !ok) return null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return user;
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}
