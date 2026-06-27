import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto';

/**
 * Admin team management. Users here are the people who can sign into /admin
 * (Role ADMIN = full access, Role STAFF = "Moderator", read-only on this page).
 * Storefront shoppers are a separate model (Customer) and are not touched here.
 *
 * Guard rails: an admin can never lock the team out — the last active admin
 * cannot be demoted or deleted, and nobody can delete their own account.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /** Count of admins who can still actually sign in. */
  private activeAdminCount(): Promise<number> {
    return this.prisma.user.count({
      where: { role: Role.ADMIN, isActive: true },
    });
  }

  async create(dto: CreateUserDto): Promise<string> {
    const passwordHash = await this.auth.hashPassword(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          name: dto.name.trim(),
          role: dto.role as Role,
          passwordHash,
          isActive: true,
        },
      });
      return user.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'A user with that email address already exists.',
        );
      }
      throw e;
    }
  }

  async setRole(id: string, role: Role, actingUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found.');
    if (id === actingUserId) {
      throw new BadRequestException('You cannot change your own role.');
    }
    if (target.role === role) return; // no-op

    // Demoting an admin must leave at least one admin standing.
    if (target.role === Role.ADMIN && role !== Role.ADMIN) {
      if ((await this.activeAdminCount()) <= 1) {
        throw new BadRequestException(
          'You cannot demote the last remaining admin.',
        );
      }
    }

    await this.prisma.user.update({ where: { id }, data: { role } });
  }

  async remove(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found.');

    if (target.role === Role.ADMIN && (await this.activeAdminCount()) <= 1) {
      throw new BadRequestException('You cannot delete the last remaining admin.');
    }

    // AdminAuditLog.userId is onDelete: SetNull, so removing a user keeps the
    // history intact (the actor just shows as "system").
    await this.prisma.user.delete({ where: { id } });
  }
}
