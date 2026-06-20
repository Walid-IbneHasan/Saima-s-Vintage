import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RedirectService {
  constructor(private readonly prisma: PrismaService) {}

  findTarget(fromPath: string) {
    return this.prisma.redirect.findUnique({ where: { fromPath } });
  }

  /** Record a redirect from an old path to a new one (idempotent upsert). */
  async record(fromPath: string, toPath: string, statusCode = 301): Promise<void> {
    if (fromPath === toPath) return;
    await this.prisma.redirect.upsert({
      where: { fromPath },
      update: { toPath, statusCode },
      create: { fromPath, toPath, statusCode },
    });
  }
}
