import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

interface AuditParams {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditParams): Promise<void> {
    const data: Prisma.AdminAuditLogUncheckedCreateInput = {
      action: params.action,
      entityType: params.entityType,
    };
    if (params.userId) data.userId = params.userId;
    if (params.entityId) data.entityId = params.entityId;
    if (params.before !== undefined) {
      data.before = params.before as Prisma.InputJsonValue;
    }
    if (params.after !== undefined) {
      data.after = params.after as Prisma.InputJsonValue;
    }
    if (params.req) {
      data.ip = params.req.ip;
      data.userAgent = (params.req.headers['user-agent'] ?? '').slice(0, 255);
    }

    // Audit must never break the action it records.
    try {
      await this.prisma.adminAuditLog.create({ data });
    } catch {
      /* swallow */
    }
  }
}
